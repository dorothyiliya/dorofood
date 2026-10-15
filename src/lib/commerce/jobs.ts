import "server-only";
import { prisma } from "@/lib/prisma";
import { ConfigError } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { releaseReservation } from "@/lib/inventory";
import { applyVerifiedPayment } from "@/lib/commerce/payments";
import { submitRefund } from "@/lib/commerce/refunds";
import { processPaymentEvent } from "@/lib/commerce/webhooks";
import { ProviderUnavailableError, verifyPaystackTransaction } from "@/lib/payments/paystack";

/** How long past the payment window we keep stock held while Paystack is unreachable. */
const PROVIDER_OUTAGE_GRACE_MS = 15 * 60_000;

/**
 * Releases stock held by orders whose payment window has closed. Before
 * releasing, it asks Paystack whether the customer actually paid, so a payment
 * completed at the last second confirms instead of being refunded.
 */
export async function expireStaleOrders({ now = new Date(), limit = 50 } = {}) {
  const candidates = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", paymentExpiresAt: { lt: now } },
    select: { id: true, paymentExpiresAt: true, payments: { where: { status: { in: ["INITIATED", "PENDING", "FAILED"] } }, select: { providerReference: true } } },
    orderBy: { paymentExpiresAt: "asc" },
    take: limit,
  });

  let expired = 0, confirmed = 0, deferred = 0;
  candidates: for (const candidate of candidates) {
    for (const payment of candidate.payments) {
      try {
        const verified = await verifyPaystackTransaction(payment.providerReference);
        if (verified.status === "success") {
          await applyVerifiedPayment(verified);
          confirmed++;
          continue candidates;
        }
      } catch (error) {
        const outage = error instanceof ProviderUnavailableError;
        if (outage && now.getTime() < candidate.paymentExpiresAt.getTime() + PROVIDER_OUTAGE_GRACE_MS) {
          deferred++;
          continue candidates;
        }
        if (!outage && !(error instanceof ConfigError)) console.error("[jobs] verification before expiry failed", error);
        // Past the grace period: release stock. A late success is still handled by applyVerifiedPayment.
      }
    }

    const didExpire = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Order" WHERE id = ${candidate.id} AND status = 'PENDING_PAYMENT' FOR UPDATE SKIP LOCKED`;
      if (locked.length !== 1) return false;
      const reservations = await tx.inventoryReservation.findMany({ where: { orderId: candidate.id, status: "ACTIVE" } });
      for (const r of reservations) await releaseReservation(tx, r, { from: ["ACTIVE"], to: "EXPIRED" });
      await tx.order.update({ where: { id: candidate.id }, data: { status: "CANCELLED", cancelledAt: now } });
      await recordAudit(tx, { action: "ORDER_PAYMENT_WINDOW_EXPIRED", entityType: "Order", entityId: candidate.id });
      return true;
    });
    if (didExpire) expired++;
  }
  return { examined: candidates.length, expired, confirmed, deferred };
}

/**
 * Catches payments whose webhook was lost or whose customer never returned:
 * verifies open attempts (including on cancelled orders, to catch late payments).
 */
export async function reconcileOpenPayments({ olderThanMinutes = 10, lookbackDays = 7, limit = 100 } = {}) {
  const now = Date.now();
  const payments = await prisma.paymentTransaction.findMany({
    where: {
      status: { in: ["INITIATED", "PENDING", "FAILED"] },
      createdAt: { lt: new Date(now - olderThanMinutes * 60_000), gt: new Date(now - lookbackDays * 86_400_000) },
    },
    select: { providerReference: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const outcomes: Record<string, number> = {};
  for (const payment of payments) {
    try {
      const { outcome } = await applyVerifiedPayment(await verifyPaystackTransaction(payment.providerReference));
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    } catch (error) {
      outcomes.ERROR = (outcomes.ERROR ?? 0) + 1;
      if (!(error instanceof ProviderUnavailableError)) console.error("[jobs] reconciliation failed", payment.providerReference, error);
    }
  }
  return { examined: payments.length, outcomes };
}

/** Webhooks that were stored but failed processing (e.g. Paystack verify was down). */
export async function retryFailedPaymentEvents({ limit = 50, maxAttempts = 20 } = {}) {
  const events = await prisma.paymentEvent.findMany({ where: { status: { in: ["FAILED", "RECEIVED"] }, attempts: { lt: maxAttempts }, receivedAt: { lt: new Date(Date.now() - 60_000) } }, take: limit, orderBy: { receivedAt: "asc" } });
  let processed = 0;
  for (const event of events) {
    if ((await processPaymentEvent(event.id)) !== "FAILED") processed++;
  }
  return { examined: events.length, processed };
}

/** Refunds recorded but never sent (e.g. credentials missing at the time). UNKNOWN outcomes are excluded on purpose. */
export async function sendUnsentRefunds({ limit = 50 } = {}) {
  const refunds = await prisma.refund.findMany({ where: { providerCallState: "NOT_SENT", status: "REFUND_PENDING" }, take: limit, orderBy: { createdAt: "asc" } });
  for (const refund of refunds) await submitRefund(refund.id);
  const needsAttention = await prisma.refund.count({ where: { OR: [{ providerCallState: "UNKNOWN" }, { status: "FAILED" }] } });
  return { attempted: refunds.length, needsManualReconciliation: needsAttention };
}

export async function runReconciliation() {
  return {
    events: await retryFailedPaymentEvents(),
    payments: await reconcileOpenPayments(),
    expiry: await expireStaleOrders(),
    refunds: await sendUnsentRefunds(),
  };
}
