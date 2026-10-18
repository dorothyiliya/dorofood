import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConfigError } from "@/lib/env";
import { lockOrder, recordAudit } from "@/lib/audit";
import { releaseReservation } from "@/lib/inventory";
import { CommerceError } from "@/lib/commerce/errors";
import { getGateway } from "@/lib/payments/gateway";
import { asGatewayPayment, ProviderRejectedError } from "@/lib/payments/types";
import { deliverQueued, enqueueRefundProcessed } from "@/lib/notifications";

const REFUNDABLE_PAYMENT = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"] as const;
const SHIPPED = ["DISPATCHED", "DELIVERED"];

export function paidAmount(payment: { amountMinor: bigint; receivedAmountMinor: bigint | null }) {
  return payment.receivedAmountMinor ?? payment.amountMinor;
}

/** Sum of refunds that have not definitively failed: these reduce what is still refundable. */
async function committedRefundTotal(tx: Prisma.TransactionClient, paymentId: string) {
  const refunds = await tx.refund.findMany({ where: { paymentId, status: { not: "FAILED" } }, select: { amountMinor: true } });
  return refunds.reduce((sum, r) => sum + r.amountMinor, BigInt(0));
}

/** Records a refund inside an existing transaction. The idempotency key makes repeats no-ops. */
export async function createRefundRecord(
  tx: Prisma.TransactionClient,
  input: { paymentId: string; amountMinor: bigint; currency: string; reason: string; idempotencyKey: string; requestedBy: string },
) {
  const existing = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  return tx.refund.create({ data: { ...input, status: "REFUND_PENDING", providerCallState: "NOT_SENT" } });
}

/**
 * Staff-initiated refund. Not exposed over HTTP: there is no staff
 * authentication yet, so it is only callable from trusted server code.
 */
export async function requestRefund(input: { orderId: string; amountMinor?: bigint; reason: string; actorId: string; idempotencyKey: string }) {
  const refund = await prisma.$transaction(async (tx) => {
    const existing = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
    if (!(await lockOrder(tx, input.orderId))) throw new CommerceError("ORDER_NOT_FOUND", 404, "Order not found.");
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: { reservations: true } });
    const payment = await tx.paymentTransaction.findFirst({ where: { orderId: order.id, status: { in: [...REFUNDABLE_PAYMENT] } }, orderBy: { createdAt: "asc" } });
    if (!payment) throw new CommerceError("NO_REFUNDABLE_PAYMENT", 409, "This order has no verified payment to refund.");

    // Refund what was actually charged, which can differ from the order total (payment review cases).
    const remaining = paidAmount(payment) - (await committedRefundTotal(tx, payment.id));
    const amount = input.amountMinor ?? remaining;
    if (amount <= BigInt(0) || amount > remaining) {
      throw new CommerceError("REFUND_EXCEEDS_REMAINING", 422, "Refund amount exceeds what remains refundable.", { remainingMinor: remaining.toString() });
    }
    const created = await createRefundRecord(tx, {
      paymentId: payment.id, amountMinor: amount, currency: payment.receivedCurrency ?? payment.currency, reason: input.reason,
      idempotencyKey: input.idempotencyKey, requestedBy: input.actorId,
    });

    if (amount === remaining && !SHIPPED.includes(order.status)) {
      // Full refund before dispatch: cancel and return allocated stock.
      for (const r of order.reservations) await releaseReservation(tx, r, { from: ["ACTIVE", "COMMITTED"], to: "RELEASED" });
      await tx.order.update({ where: { id: order.id }, data: { status: "REFUND_PENDING", cancelledAt: order.cancelledAt ?? new Date() } });
    }
    await recordAudit(tx, { action: "REFUND_REQUESTED", entityType: "Order", entityId: order.id, actorId: input.actorId, metadata: { refundId: created.id, amountMinor: amount, reason: input.reason } });
    return created;
  });

  await submitRefund(refund.id);
  return prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
}

/**
 * Sends a refund to the payment's gateway at most once. Neither Paystack's nor
 * Whop's refund API takes an idempotency key, so a call whose outcome is unknown
 * is marked UNKNOWN and never retried automatically; a blind retry could refund
 * the customer twice.
 */
export async function submitRefund(refundId: string) {
  const claimed = await prisma.refund.updateMany({ where: { id: refundId, providerCallState: "NOT_SENT" }, data: { providerCallState: "SENDING" } });
  if (claimed.count !== 1) return;
  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });

  try {
    const gateway = await getGateway(refund.payment.provider);
    const result = await gateway.refund({ payment: asGatewayPayment(refund.payment), amountMinor: refund.amountMinor, note: refund.reason.slice(0, 200) });
    await prisma.refund.update({ where: { id: refundId }, data: { providerCallState: "SENT", providerRef: result.providerRef } });
  } catch (error) {
    if (error instanceof ConfigError) {
      // Nothing was sent; safe to retry once credentials are configured.
      await prisma.refund.update({ where: { id: refundId }, data: { providerCallState: "NOT_SENT", failureReason: error.code } });
      return;
    }
    const rejected = error instanceof ProviderRejectedError;
    await prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refundId },
        data: rejected
          ? { providerCallState: "REJECTED", status: "FAILED", failureReason: (error as Error).message.slice(0, 1000) }
          : { providerCallState: "UNKNOWN", failureReason: `Outcome unknown, reconcile manually in the provider dashboard: ${(error as Error).message}`.slice(0, 1000) },
      });
      await recordAudit(tx, { action: rejected ? "REFUND_REJECTED" : "REFUND_OUTCOME_UNKNOWN", entityType: "Refund", entityId: refundId, metadata: { message: (error as Error).message } });
    });
  }
}

type RefundEventData = { id?: unknown; amount?: unknown; status?: unknown; transaction_reference?: unknown; transaction?: unknown };

/** Applies refund.* webhooks. Idempotent: a refund only leaves REFUND_PENDING once. */
export async function applyRefundEvent(eventType: string, data: RefundEventData): Promise<"PROCESSED" | "IGNORED"> {
  const providerRef = data.id == null ? null : String(data.id);
  const transactionRef = typeof data.transaction_reference === "string" ? data.transaction_reference
    : typeof data.transaction === "object" && data.transaction && typeof (data.transaction as { reference?: unknown }).reference === "string"
      ? (data.transaction as { reference: string }).reference : null;

  let refund = providerRef ? await prisma.refund.findUnique({ where: { providerRef } }) : null;
  if (!refund && transactionRef) {
    // The refund API call's response may have been lost; match by transaction and amount.
    const amount = typeof data.amount === "number" || typeof data.amount === "string" ? BigInt(String(data.amount)) : null;
    refund = await prisma.refund.findFirst({
      where: { providerRef: null, payment: { providerReference: transactionRef }, providerCallState: { in: ["SENDING", "SENT", "UNKNOWN"] }, ...(amount !== null ? { amountMinor: amount } : {}) },
      orderBy: { createdAt: "asc" },
    });
    if (refund && providerRef) await prisma.refund.update({ where: { id: refund.id }, data: { providerRef, providerCallState: "SENT" } });
  }
  if (!refund) return "IGNORED";

  const target = eventType === "refund.processed" ? "REFUNDED" : eventType === "refund.failed" ? "FAILED" : null;
  if (!target) return "PROCESSED"; // pending / processing / needs-attention: informational only
  await finaliseRefund(refund.id, target, { actorId: "system", failureReason: "Provider reported refund.failed" });
  return "PROCESSED";
}

/**
 * Moves a pending refund to its final state (from a webhook, or from staff after
 * reconciling it in the Paystack dashboard) and settles payment/order status.
 * Returns false if the refund was already final.
 */
export async function finaliseRefund(
  refundId: string,
  target: "REFUNDED" | "FAILED",
  options: { actorId: string; failureReason?: string; providerRef?: string; providerCallState?: "SENT" | "REJECTED"; note?: string },
) {
  const result = await prisma.$transaction(async (tx) => {
    const notify: string[] = [];
    const payment = await tx.paymentTransaction.findFirstOrThrow({ where: { refunds: { some: { id: refundId } } } });
    await lockOrder(tx, payment.orderId);
    const moved = await tx.refund.updateMany({
      where: { id: refundId, status: "REFUND_PENDING" },
      data: {
        status: target,
        ...(target === "FAILED" ? { failureReason: options.failureReason ?? "Refund failed" } : {}),
        ...(options.providerRef ? { providerRef: options.providerRef } : {}),
        ...(options.providerCallState ? { providerCallState: options.providerCallState } : {}),
      },
    });
    if (moved.count !== 1) return { changed: false, notify };
    await recordAudit(tx, { action: target === "REFUNDED" ? "REFUND_PROCESSED" : "REFUND_FAILED", entityType: "Refund", entityId: refundId, actorId: options.actorId, metadata: options.note ? { note: options.note } : undefined });
    if (target !== "REFUNDED") return { changed: true, notify };

    const processed = await tx.refund.findMany({ where: { paymentId: payment.id, status: "REFUNDED" }, select: { amountMinor: true } });
    const refunded = processed.reduce((s, r) => s + r.amountMinor, BigInt(0));
    const full = refunded >= paidAmount(payment);
    await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    if (full) {
      // A duplicate charge being refunded must not change the status of the order it duplicated.
      const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
      if (order.status === "REFUND_PENDING") await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
    }
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    notify.push(await enqueueRefundProcessed(tx, payment.orderId, { id: refund.id, amountMinor: refund.amountMinor, currency: refund.currency, full }));
    return { changed: true, notify };
  });
  await deliverQueued(result.notify);
  return result.changed;
}
