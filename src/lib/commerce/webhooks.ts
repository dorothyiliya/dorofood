import "server-only";
import { createHash } from "node:crypto";
import type { PaymentEvent, PaymentTransaction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { jsonSafe } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/commerce/errors";
import { applyVerifiedPayment } from "@/lib/commerce/payments";
import { applyRefundEvent, finaliseRefund } from "@/lib/commerce/refunds";
import { getGateway } from "@/lib/payments/gateway";
import { getPaystackWebhookSecret, verifyPaystackWebhook } from "@/lib/payments/paystack";
import { getWhopConfig, verifyWhopWebhook } from "@/lib/payments/whop";
import { asGatewayPayment } from "@/lib/payments/types";

export const MAX_WEBHOOK_BYTES = 256 * 1024;

type WebhookResult = { status: number; body: Record<string, unknown> };
type Outcome = "PROCESSED" | "IGNORED" | "FAILED";

/**
 * Every provider's notifications follow the same path:
 * 1. Authenticate the raw body (provider-specific signature).
 * 2. Persist durably, deduplicated, before acknowledging.
 * 3. Process: amounts are never read from the webhook; payment events trigger a
 *    server-to-server verification through the gateway instead.
 * A non-2xx response makes the provider redeliver; stored FAILED events are also
 * retried by the reconciliation job.
 */
async function storeAndProcess(provider: string, dedupeKey: string, eventType: string, reference: string | null, payload: unknown): Promise<WebhookResult> {
  const payloadHash = createHash("sha256").update(dedupeKey).digest("hex");
  let stored: PaymentEvent;
  try {
    stored = await prisma.paymentEvent.create({ data: { provider, eventType, payloadHash, reference, payloadJson: jsonSafe(payload) } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    stored = await prisma.paymentEvent.findUniqueOrThrow({ where: { provider_payloadHash: { provider, payloadHash } } });
    if (stored.status === "PROCESSED" || stored.status === "IGNORED") return { status: 200, body: { received: true, duplicate: true } };
  }
  const status = await processPaymentEvent(stored.id);
  return status === "FAILED"
    ? { status: 500, body: { received: true, processed: false } }
    : { status: 200, body: { received: true, processed: status === "PROCESSED" } };
}

function paystackReference(data: Record<string, unknown>): string | null {
  if (typeof data.reference === "string") return data.reference;
  if (typeof data.transaction_reference === "string") return data.transaction_reference;
  const transaction = data.transaction as { reference?: unknown } | undefined;
  return transaction && typeof transaction.reference === "string" ? transaction.reference : null;
}

/** Paystack: HMAC-SHA512 of the raw body with the secret key; deduplicated on the body hash. */
export async function handlePaystackWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
  const secret = await getPaystackWebhookSecret(); // ConfigError -> 503 at the route, so Paystack retries later
  if (!signature || !verifyPaystackWebhook(rawBody, signature, secret)) return { status: 401, body: { error: "Invalid webhook signature" } };
  let event: { event?: unknown; data?: unknown };
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: { error: "Invalid JSON" } }; }
  if (typeof event.event !== "string" || !event.data || typeof event.data !== "object") return { status: 400, body: { error: "Incomplete event" } };
  return storeAndProcess("paystack", rawBody, event.event, paystackReference(event.data as Record<string, unknown>), event);
}

/** Whop: Standard Webhooks signature with replay window; deduplicated on webhook-id, which retries reuse. */
export async function handleWhopWebhook(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }): Promise<WebhookResult> {
  const { webhookSecret } = await getWhopConfig("existing");
  const check = verifyWhopWebhook(rawBody, headers, webhookSecret);
  if (!check.ok) return { status: 401, body: { error: "Invalid webhook signature" } };
  let event: { type?: unknown; data?: unknown };
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: { error: "Invalid JSON" } }; }
  if (typeof event.type !== "string" || !event.data || typeof event.data !== "object") return { status: 400, body: { error: "Incomplete event" } };
  const metadata = (event.data as { metadata?: { reference?: unknown } }).metadata;
  return storeAndProcess("whop", `whop:${headers.id}`, event.type, typeof metadata?.reference === "string" ? metadata.reference : null, event);
}

/** Processes a stored event. Safe to run more than once for the same event. */
export async function processPaymentEvent(eventId: string): Promise<Outcome> {
  const event = await prisma.paymentEvent.update({ where: { id: eventId }, data: { attempts: { increment: 1 } } });
  try {
    const status = event.provider === "whop" ? await processWhopEvent(event) : await processPaystackEvent(event);
    await prisma.paymentEvent.update({ where: { id: eventId }, data: { status, processedAt: new Date(), lastError: null } });
    return status;
  } catch (error) {
    console.error("[webhook] processing failed", { eventId, provider: event.provider, error: (error as Error).message });
    await prisma.paymentEvent.update({ where: { id: eventId }, data: { status: "FAILED", lastError: String((error as Error).message).slice(0, 2000) } });
    return "FAILED";
  }
}

async function verifyAndApply(payment: PaymentTransaction): Promise<"PROCESSED" | "IGNORED"> {
  const gateway = await getGateway(payment.provider);
  const { outcome } = await applyVerifiedPayment(await gateway.verify(asGatewayPayment(payment)));
  return outcome === "UNKNOWN_REFERENCE" ? "IGNORED" : "PROCESSED";
}

async function processPaystackEvent(event: PaymentEvent): Promise<"PROCESSED" | "IGNORED"> {
  const payload = event.payloadJson as { event: string; data: Record<string, unknown> };
  if (payload.event === "charge.success" && event.reference) {
    const payment = await prisma.paymentTransaction.findUnique({ where: { providerReference: event.reference } });
    return payment ? verifyAndApply(payment) : "IGNORED";
  }
  if (payload.event.startsWith("refund.")) return applyRefundEvent(payload.event, payload.data);
  return "IGNORED";
}

type WhopData = { id?: unknown; status?: unknown; amount?: unknown; checkout_configuration_id?: unknown; metadata?: { reference?: unknown } | null; payment?: unknown; payment_id?: unknown };

async function processWhopEvent(event: PaymentEvent): Promise<"PROCESSED" | "IGNORED"> {
  const payload = event.payloadJson as { type: string; data: WhopData };
  const data = payload.data;

  if (payload.type.startsWith("payment.")) {
    const checkoutId = typeof data.checkout_configuration_id === "string" ? data.checkout_configuration_id : null;
    const payment = event.reference
      ? await prisma.paymentTransaction.findUnique({ where: { providerReference: event.reference } })
      : checkoutId ? await prisma.paymentTransaction.findFirst({ where: { provider: "whop", metadataJson: { path: ["checkoutConfigurationId"], equals: checkoutId } } }) : null;
    if (!payment || payment.provider !== "whop") return "IGNORED";
    if (!payment.providerTransactionId && typeof data.id === "string" && data.id.startsWith("pay_")) {
      payment.providerTransactionId = data.id;
      await prisma.paymentTransaction.update({ where: { id: payment.id }, data: { providerTransactionId: data.id } });
    }
    return verifyAndApply(payment);
  }

  if (payload.type.startsWith("refund.")) {
    const refundId = typeof data.id === "string" ? data.id : null;
    const paymentId = typeof data.payment_id === "string" ? data.payment_id
      : typeof data.payment === "string" ? data.payment
      : typeof (data.payment as { id?: unknown } | null)?.id === "string" ? (data.payment as { id: string }).id : null;
    let refund = refundId ? await prisma.refund.findUnique({ where: { providerRef: refundId } }) : null;
    if (!refund && paymentId) {
      // The refund call's response may have been lost: match the payment and amount.
      const amount = typeof data.amount === "number" ? BigInt(Math.round(data.amount * 100)) : null;
      refund = await prisma.refund.findFirst({
        where: { providerRef: null, payment: { provider: "whop", providerTransactionId: paymentId }, providerCallState: { in: ["SENDING", "SENT", "UNKNOWN"] }, ...(amount !== null ? { amountMinor: amount } : {}) },
        orderBy: { createdAt: "asc" },
      });
    }
    if (!refund) return "IGNORED";
    const status = typeof data.status === "string" ? data.status : "";
    if (status === "succeeded") await finaliseRefund(refund.id, "REFUNDED", { actorId: "system", providerRef: refundId ?? undefined, providerCallState: "SENT" });
    else if (status === "failed" || status === "canceled") await finaliseRefund(refund.id, "FAILED", { actorId: "system", failureReason: `Whop reported refund ${status}`, providerRef: refundId ?? undefined, providerCallState: "SENT" });
    return "PROCESSED";
  }
  return "IGNORED";
}
