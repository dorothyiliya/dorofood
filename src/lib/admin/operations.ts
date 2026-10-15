import "server-only";
import { prisma } from "@/lib/prisma";
import { lockOrder, recordAudit } from "@/lib/audit";
import { releaseReservation } from "@/lib/inventory";
import { CommerceError } from "@/lib/commerce/errors";
import { allocateStockForPaidOrder, confirmPaymentByReference } from "@/lib/commerce/payments";
import { finaliseRefund, requestRefund } from "@/lib/commerce/refunds";
import { createShipmentForOrder, markShipmentDispatched, reviewExport, type CarrierAdapter } from "@/lib/commerce/shipments";
import { processPaymentEvent } from "@/lib/commerce/webhooks";

/** Staff cancels an order nobody has paid for yet; its stock returns to sale. A later payment is still handled (and refunded if stock is gone). */
export async function cancelUnpaidOrder(orderId: string, actorId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) throw new CommerceError("ORDER_NOT_FOUND", 404, "Order not found.");
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { reservations: { where: { status: "ACTIVE" } } } });
    if (order.status !== "PENDING_PAYMENT") throw new CommerceError("ORDER_NOT_CANCELLABLE", 409, `Only unpaid orders can be cancelled here (this one is ${order.status}). Use a refund instead.`);
    for (const r of order.reservations) await releaseReservation(tx, r, { from: ["ACTIVE"], to: "RELEASED" });
    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await recordAudit(tx, { action: "ORDER_CANCELLED_BY_STAFF", entityType: "Order", entityId: orderId, actorId, metadata: { reason } });
  });
}

/**
 * An order in PAYMENT_REVIEW received a payment that did not match. Staff either
 * accepts it (stock is allocated and the order confirmed) or refunds what was charged.
 */
export async function resolvePaymentReview(orderId: string, decision: "ACCEPT" | "REFUND", actorId: string, note: string) {
  if (decision === "REFUND") {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (order?.status !== "PAYMENT_REVIEW") throw new CommerceError("NOT_IN_REVIEW", 409, "This order is not awaiting payment review.");
    await requestRefund({ orderId, reason: `PAYMENT_REVIEW_REFUND: ${note}`.slice(0, 300), actorId, idempotencyKey: `review-refund:${orderId}` });
    return;
  }
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) throw new CommerceError("ORDER_NOT_FOUND", 404, "Order not found.");
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, reservations: true, payments: { where: { status: "SUCCEEDED" } } } });
    if (order.status !== "PAYMENT_REVIEW") throw new CommerceError("NOT_IN_REVIEW", 409, "This order is not awaiting payment review.");
    if (order.payments.length === 0) throw new CommerceError("NO_VERIFIED_PAYMENT", 409, "There is no verified payment to accept.");
    if (!(await allocateStockForPaidOrder(tx, order))) {
      throw new CommerceError("OUT_OF_STOCK", 409, "Stock is no longer available for this order. Refund it instead.");
    }
    await tx.order.update({ where: { id: orderId }, data: { status: "CONFIRMED", confirmedAt: new Date(), cancelledAt: null } });
    await recordAudit(tx, { action: "PAYMENT_REVIEW_ACCEPTED", entityType: "Order", entityId: orderId, actorId, metadata: { note } });
  });
}

export async function verifyPaymentNow(paymentId: string, actorId: string) {
  const payment = await prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
  if (!payment) throw new CommerceError("PAYMENT_NOT_FOUND", 404, "Payment not found.");
  const result = await confirmPaymentByReference(payment.providerReference);
  await prisma.$transaction((tx) => recordAudit(tx, { action: "PAYMENT_VERIFIED_BY_STAFF", entityType: "Order", entityId: payment.orderId, actorId, metadata: result }));
  return result;
}

export async function reprocessPaymentEvent(eventId: string, actorId: string) {
  const event = await prisma.paymentEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new CommerceError("EVENT_NOT_FOUND", 404, "Event not found.");
  if (event.status === "PROCESSED") throw new CommerceError("EVENT_ALREADY_PROCESSED", 409, "This event was already processed.");
  const status = await processPaymentEvent(eventId);
  await prisma.$transaction((tx) => recordAudit(tx, { action: "PAYMENT_EVENT_REPROCESSED", entityType: "PaymentEvent", entityId: eventId, actorId, metadata: { status } }));
  return status;
}

export async function issueRefund(input: { orderId: string; amountMinor?: bigint; reason: string; actorId: string; idempotencyKey: string }) {
  return requestRefund(input);
}

/**
 * A refund whose provider call outcome was unknown (or that is stuck) has been
 * checked by a person in the Paystack dashboard; record what they found.
 */
export async function resolveRefundManually(refundId: string, outcome: "REFUNDED" | "FAILED", actorId: string, note: string, providerRef?: string) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw new CommerceError("REFUND_NOT_FOUND", 404, "Refund not found.");
  if (refund.status !== "REFUND_PENDING") throw new CommerceError("REFUND_ALREADY_FINAL", 409, `This refund is already ${refund.status}.`);
  if (refund.providerCallState === "SENDING" && Date.now() - refund.updatedAt.getTime() < 5 * 60_000) {
    throw new CommerceError("REFUND_IN_FLIGHT", 409, "This refund is being sent right now. Try again in a few minutes.");
  }
  await finaliseRefund(refundId, outcome, {
    actorId,
    note,
    failureReason: `Marked failed by staff: ${note}`.slice(0, 1000),
    providerRef: providerRef || undefined,
    providerCallState: outcome === "REFUNDED" ? "SENT" : "REJECTED",
  });
}

/** Ships with a courier booked outside the system: staff records the carrier and tracking number. */
export async function createManualShipment(orderId: string, input: { carrier: string; trackingNumber: string; trackingUrl?: string }, actorId: string) {
  const adapter: CarrierAdapter = {
    code: `MANUAL:${input.carrier}`.slice(0, 60),
    createShipment: async () => ({ trackingNumber: input.trackingNumber, trackingUrl: input.trackingUrl ?? null, serviceCode: "manual" }),
  };
  return createShipmentForOrder(orderId, adapter, actorId);
}

export async function dispatchShipment(shipmentId: string, actorId: string) {
  return markShipmentDispatched(shipmentId, actorId);
}

export async function markShipmentDelivered(shipmentId: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new CommerceError("SHIPMENT_NOT_FOUND", 404, "Shipment not found.");
    await lockOrder(tx, shipment.orderId);
    const moved = await tx.shipment.updateMany({ where: { id: shipmentId, status: { in: ["DISPATCHED", "IN_TRANSIT", "CUSTOMS_HOLD"] } }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    if (moved.count !== 1) throw new CommerceError("SHIPMENT_NOT_DISPATCHED", 409, "Only dispatched shipments can be marked delivered.");
    await tx.order.updateMany({ where: { id: shipment.orderId, status: "DISPATCHED" }, data: { status: "DELIVERED" } });
    await recordAudit(tx, { action: "ORDER_DELIVERED", entityType: "Order", entityId: shipment.orderId, actorId, metadata: { shipmentId } });
  });
}

export async function decideExport(orderId: string, decision: "APPROVED" | "REJECTED", actorId: string, reason?: string) {
  return reviewExport(orderId, decision, actorId, reason);
}
