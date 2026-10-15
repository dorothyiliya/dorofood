import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockOrder, recordAudit } from "@/lib/audit";
import { commitReservation, InsufficientStockError, releaseReservation, reserveInventory } from "@/lib/inventory";
import { createRefundRecord, submitRefund } from "@/lib/commerce/refunds";
import { CommerceError } from "@/lib/commerce/errors";
import { verifyPaystackTransaction, type VerifiedPayment } from "@/lib/payments/paystack";

export type PaymentOutcome =
  | "UNKNOWN_REFERENCE"
  | "ALREADY_PROCESSED"
  | "PAYMENT_PENDING"
  | "PAYMENT_FAILED"
  | "CONFIRMED"
  | "LATE_PAYMENT_CONFIRMED"
  | "AMOUNT_MISMATCH_REVIEW"
  | "REVIEW_REQUIRED"
  | "REFUND_REQUIRED_NO_STOCK"
  | "DUPLICATE_PAYMENT_REFUNDED";

const OPEN_PAYMENT = ["INITIATED", "PENDING", "FAILED"] as const;
const PAID_ORDER = ["CONFIRMED", "PROCESSING", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "REFUND_PENDING", "REFUNDED"];

/**
 * Applies a server-verified Paystack result. Every caller (webhook, customer
 * return page, reconciliation job) funnels through here, and the payment and
 * order rows are locked, so duplicate and concurrent notifications produce
 * exactly one state change.
 */
export async function applyVerifiedPayment(verified: VerifiedPayment): Promise<{ outcome: PaymentOutcome; orderNumber?: string }> {
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "PaymentTransaction" WHERE "providerReference" = ${verified.reference} FOR UPDATE`;
    if (locked.length !== 1) return { outcome: "UNKNOWN_REFERENCE" as const, refundIds: [] as string[] };

    const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: locked[0].id } });
    await lockOrder(tx, payment.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId }, include: { items: true, reservations: true } });
    const done = (outcome: PaymentOutcome, refundIds: string[] = []) => ({ outcome, refundIds, orderNumber: order.orderNumber });

    if (!(OPEN_PAYMENT as readonly string[]).includes(payment.status)) return done("ALREADY_PROCESSED");

    if (verified.status === "pending") {
      await tx.paymentTransaction.update({ where: { id: payment.id }, data: { rawStatus: verified.rawStatus } });
      return done("PAYMENT_PENDING");
    }
    if (verified.status === "failed") {
      // Not terminal for the order: the customer may retry until the payment window closes.
      await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: "FAILED", rawStatus: verified.rawStatus } });
      return done("PAYMENT_FAILED");
    }

    const amountMatches = verified.amountMinor === payment.amountMinor && verified.currency === payment.currency
      && payment.amountMinor === order.totalMinor && payment.currency === order.currency;
    await tx.paymentTransaction.update({
      where: { id: payment.id },
      data: {
        status: "SUCCEEDED", rawStatus: verified.rawStatus, verifiedAt: new Date(), paidAt: verified.paidAt,
        providerTransactionId: verified.providerTransactionId,
        failureReason: amountMatches ? null : `AMOUNT_MISMATCH: received ${verified.amountMinor} ${verified.currency}, expected ${payment.amountMinor} ${payment.currency}`,
      },
    });

    // The order was already paid by another attempt: refund this charge in full.
    if (PAID_ORDER.includes(order.status)) {
      const refund = await createRefundRecord(tx, {
        paymentId: payment.id, amountMinor: verified.amountMinor, currency: verified.currency,
        reason: "DUPLICATE_PAYMENT", idempotencyKey: `auto:duplicate:${payment.id}`, requestedBy: "system",
      });
      await recordAudit(tx, { action: "DUPLICATE_PAYMENT_REFUND", entityType: "Order", entityId: order.id, metadata: { reference: payment.providerReference } });
      return done("DUPLICATE_PAYMENT_REFUNDED", [refund.id]);
    }
    if (!amountMatches) {
      await tx.order.update({ where: { id: order.id }, data: { status: "PAYMENT_REVIEW" } });
      await recordAudit(tx, { action: "PAYMENT_AMOUNT_MISMATCH", entityType: "Order", entityId: order.id, metadata: { reference: payment.providerReference, receivedMinor: verified.amountMinor, currency: verified.currency } });
      return done("AMOUNT_MISMATCH_REVIEW");
    }
    if (order.status === "PAYMENT_REVIEW") {
      await recordAudit(tx, { action: "PAYMENT_ON_ORDER_UNDER_REVIEW", entityType: "Order", entityId: order.id, metadata: { reference: payment.providerReference } });
      return done("REVIEW_REQUIRED");
    }

    // PENDING_PAYMENT, or CANCELLED because the payment window expired first.
    const late = order.status === "CANCELLED";
    const allocated = await allocateStockForPaidOrder(tx, order);
    if (!allocated) {
      const refund = await createRefundRecord(tx, {
        paymentId: payment.id, amountMinor: verified.amountMinor, currency: verified.currency,
        reason: "STOCK_UNAVAILABLE_AFTER_PAYMENT", idempotencyKey: `auto:no-stock:${payment.id}`, requestedBy: "system",
      });
      await tx.order.update({ where: { id: order.id }, data: { status: "REFUND_PENDING", cancelledAt: order.cancelledAt ?? new Date() } });
      await recordAudit(tx, { action: "PAID_ORDER_UNFULFILLABLE", entityType: "Order", entityId: order.id, metadata: { reference: payment.providerReference, late } });
      return done("REFUND_REQUIRED_NO_STOCK", [refund.id]);
    }
    await tx.order.update({ where: { id: order.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), cancelledAt: null } });
    await recordAudit(tx, { action: late ? "LATE_PAYMENT_CONFIRMED" : "PAYMENT_CONFIRMED", entityType: "Order", entityId: order.id, metadata: { reference: payment.providerReference, amountMinor: verified.amountMinor } });
    return done(late ? "LATE_PAYMENT_CONFIRMED" : "CONFIRMED");
  }, { maxWait: 20_000, timeout: 20_000 });

  for (const refundId of result.refundIds) {
    await submitRefund(refundId).catch((error) => console.error("[payments] refund submission failed", { refundId, error }));
  }
  return { outcome: result.outcome, orderNumber: "orderNumber" in result ? result.orderNumber : undefined };
}

/**
 * Commits the order's live reservations and re-reserves any line whose
 * reservation already expired. All-or-nothing: if any line cannot be covered,
 * everything allocated for the order is returned to stock.
 */
async function allocateStockForPaidOrder(
  tx: Prisma.TransactionClient,
  order: Prisma.OrderGetPayload<{ include: { items: true; reservations: true } }>,
) {
  const covered = new Map<string, number>();
  let locationId: string | null = null;
  for (const r of order.reservations) {
    locationId ??= r.locationId;
    const committed = r.status === "ACTIVE" ? await commitReservation(tx, r.id) : r.status === "COMMITTED";
    if (committed) covered.set(r.variantId, (covered.get(r.variantId) ?? 0) + r.quantity);
  }
  if (!locationId) return false;

  for (const item of [...order.items].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
    const missing = item.quantity - (covered.get(item.variantId) ?? 0);
    if (missing <= 0) continue;
    try {
      await reserveInventory(tx, { variantId: item.variantId, locationId, quantity: missing, orderId: order.id, expiresAt: new Date(), status: "COMMITTED" });
    } catch (error) {
      if (!(error instanceof InsufficientStockError)) throw error;
      const current = await tx.inventoryReservation.findMany({ where: { orderId: order.id, status: { in: ["ACTIVE", "COMMITTED"] } } });
      for (const r of current) await releaseReservation(tx, r, { from: ["ACTIVE", "COMMITTED"], to: "RELEASED" });
      return false;
    }
  }
  return true;
}

/**
 * Customer-facing confirmation (return from Paystack, or a client that lost the
 * response). Only ever trusts a fresh server-to-server verification.
 */
export async function confirmPaymentByReference(reference: string) {
  const payment = await prisma.paymentTransaction.findUnique({ where: { providerReference: reference }, include: { order: true } });
  if (!payment) throw new CommerceError("PAYMENT_NOT_FOUND", 404, "Payment not found.");
  const needsVerification = (OPEN_PAYMENT as readonly string[]).includes(payment.status);
  if (needsVerification) await applyVerifiedPayment(await verifyPaystackTransaction(reference));
  const fresh = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id }, include: { order: true } });
  return { orderNumber: fresh.order.orderNumber, orderStatus: fresh.order.status, paymentStatus: fresh.status };
}
