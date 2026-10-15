import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { jsonSafe } from "@/lib/audit";
import { getPaystackWebhookSecret } from "@/lib/env";
import { isUniqueViolation } from "@/lib/commerce/errors";
import { applyVerifiedPayment } from "@/lib/commerce/payments";
import { applyRefundEvent } from "@/lib/commerce/refunds";
import { verifyPaystackTransaction, verifyPaystackWebhook } from "@/lib/payments/paystack";

export const MAX_WEBHOOK_BYTES = 256 * 1024;

type WebhookResult = { status: number; body: Record<string, unknown> };

function referenceOf(data: Record<string, unknown>): string | null {
  if (typeof data.reference === "string") return data.reference;
  if (typeof data.transaction_reference === "string") return data.transaction_reference;
  const transaction = data.transaction as { reference?: unknown } | undefined;
  return transaction && typeof transaction.reference === "string" ? transaction.reference : null;
}

/**
 * 1. Authenticate (HMAC-SHA512 of the raw body).
 * 2. Persist durably, deduplicated on the payload hash, before acknowledging.
 * 3. Process: amounts are never read from the webhook; charge events trigger a
 *    server-to-server verification instead.
 * A non-2xx response makes Paystack redeliver; stored FAILED events are also
 * retried by the reconciliation job.
 */
export async function handlePaystackWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
  const secret = getPaystackWebhookSecret(); // ConfigError -> 503 at the route, so Paystack retries later
  if (!signature || !verifyPaystackWebhook(rawBody, signature, secret)) {
    return { status: 401, body: { error: "Invalid webhook signature" } };
  }

  let event: { event?: unknown; data?: unknown };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  if (typeof event.event !== "string" || !event.data || typeof event.data !== "object") {
    return { status: 400, body: { error: "Incomplete event" } };
  }

  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  let stored;
  try {
    stored = await prisma.paymentEvent.create({
      data: { provider: "paystack", eventType: event.event, payloadHash, reference: referenceOf(event.data as Record<string, unknown>), payloadJson: jsonSafe(event) },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    stored = await prisma.paymentEvent.findUniqueOrThrow({ where: { provider_payloadHash: { provider: "paystack", payloadHash } } });
    if (stored.status === "PROCESSED" || stored.status === "IGNORED") {
      return { status: 200, body: { received: true, duplicate: true } };
    }
  }

  const status = await processPaymentEvent(stored.id);
  return status === "FAILED"
    ? { status: 500, body: { received: true, processed: false } }
    : { status: 200, body: { received: true, processed: status === "PROCESSED" } };
}

/** Processes a stored event. Safe to run more than once for the same event. */
export async function processPaymentEvent(eventId: string): Promise<"PROCESSED" | "IGNORED" | "FAILED"> {
  const event = await prisma.paymentEvent.update({ where: { id: eventId }, data: { attempts: { increment: 1 } } });
  const payload = event.payloadJson as { event: string; data: Record<string, unknown> };
  try {
    let status: "PROCESSED" | "IGNORED" = "IGNORED";
    if (payload.event === "charge.success" && event.reference) {
      const { outcome } = await applyVerifiedPayment(await verifyPaystackTransaction(event.reference));
      status = outcome === "UNKNOWN_REFERENCE" ? "IGNORED" : "PROCESSED";
    } else if (payload.event.startsWith("refund.")) {
      status = await applyRefundEvent(payload.event, payload.data);
    }
    await prisma.paymentEvent.update({ where: { id: eventId }, data: { status, processedAt: new Date(), lastError: null } });
    return status;
  } catch (error) {
    console.error("[webhook] processing failed", { eventId, error: (error as Error).message });
    await prisma.paymentEvent.update({ where: { id: eventId }, data: { status: "FAILED", lastError: String((error as Error).message).slice(0, 2000) } });
    return "FAILED";
  }
}
