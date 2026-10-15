"use server";

import { adminAction, type ActionState } from "@/lib/admin/action";
import { id, oneOf, optionalMoney, text } from "@/lib/admin/form";
import {
  cancelUnpaidOrder, createManualShipment, decideExport, dispatchShipment, issueRefund, markShipmentDelivered,
  reprocessPaymentEvent, resolvePaymentReview, resolveRefundManually, verifyPaymentNow,
} from "@/lib/admin/operations";
import { runReconciliationJob } from "@/lib/admin/system";

function required(value: string, label: string) {
  if (!value) throw new RangeError(`${label} is required.`);
  return value;
}

export async function cancelOrderAction(_: ActionState, form: FormData) {
  return adminAction("orders.manage", async (staff) => {
    await cancelUnpaidOrder(id(form, "orderId"), staff.id, required(text(form, "reason", 300), "Reason"));
    return "Order cancelled and its stock released.";
  }, { storefront: true });
}

export async function verifyPaymentAction(_: ActionState, form: FormData) {
  return adminAction("orders.manage", async (staff) => {
    const result = await verifyPaymentNow(id(form, "paymentId"), staff.id);
    return `Paystack says: payment ${result.paymentStatus.toLowerCase()}, order ${result.orderStatus.toLowerCase().replace(/_/g, " ")}.`;
  });
}

export async function resolveReviewAction(_: ActionState, form: FormData) {
  const decision = oneOf(form, "decision", ["ACCEPT", "REFUND"] as const);
  return adminAction(decision === "ACCEPT" ? "orders.manage" : "refunds.manage", async (staff) => {
    await resolvePaymentReview(id(form, "orderId"), decision, staff.id, required(text(form, "note", 300), "Note"));
    return decision === "ACCEPT" ? "Payment accepted and order confirmed." : "Refund of the amount received has been started.";
  }, { storefront: true });
}

export async function refundAction(_: ActionState, form: FormData) {
  return adminAction("refunds.manage", async (staff) => {
    const refund = await issueRefund({
      orderId: id(form, "orderId"),
      amountMinor: optionalMoney(form, "amount") ?? undefined,
      reason: required(text(form, "reason", 300), "Reason"),
      actorId: staff.id,
      idempotencyKey: `admin:${id(form, "idempotencyKey")}`,
    });
    if (refund.status === "FAILED") return `Paystack rejected the refund: ${refund.failureReason ?? "no reason given"}`;
    if (refund.providerCallState === "UNKNOWN") return "Refund sent but Paystack did not confirm it. Check the Paystack dashboard before doing anything else.";
    if (refund.providerCallState === "NOT_SENT") return "Refund recorded but not sent: Paystack is not configured. It will be sent automatically once it is.";
    return "Refund submitted to Paystack.";
  });
}

export async function resolveRefundAction(_: ActionState, form: FormData) {
  return adminAction("refunds.manage", async (staff) => {
    const outcome = oneOf(form, "outcome", ["REFUNDED", "FAILED"] as const);
    await resolveRefundManually(id(form, "refundId"), outcome, staff.id, required(text(form, "note", 500), "Note"), text(form, "providerRef", 60) || undefined);
    return outcome === "REFUNDED" ? "Refund recorded as completed." : "Refund recorded as failed; the amount is refundable again.";
  });
}

export async function manualShipmentAction(_: ActionState, form: FormData) {
  return adminAction("orders.fulfil", async (staff) => {
    const trackingUrl = text(form, "trackingUrl", 500);
    if (trackingUrl && !/^https:\/\/[^\s]+$/.test(trackingUrl)) throw new RangeError("Tracking link must start with https://");
    await createManualShipment(id(form, "orderId"), {
      carrier: required(text(form, "carrier", 50), "Carrier"),
      trackingNumber: required(text(form, "trackingNumber", 80), "Tracking number"),
      trackingUrl: trackingUrl || undefined,
    }, staff.id);
    return "Shipment created. Mark it dispatched when the parcel leaves.";
  });
}

export async function dispatchAction(_: ActionState, form: FormData) {
  return adminAction("orders.fulfil", async (staff) => {
    await dispatchShipment(id(form, "shipmentId"), staff.id);
    return "Marked dispatched; stock has left the warehouse.";
  }, { storefront: true });
}

export async function deliveredAction(_: ActionState, form: FormData) {
  return adminAction("orders.fulfil", async (staff) => {
    await markShipmentDelivered(id(form, "shipmentId"), staff.id);
    return "Marked delivered.";
  });
}

export async function exportDecisionAction(_: ActionState, form: FormData) {
  return adminAction("orders.fulfil", async (staff) => {
    const decision = oneOf(form, "decision", ["APPROVED", "REJECTED"] as const);
    const reason = text(form, "reason", 500);
    if (decision === "REJECTED" && !reason) throw new RangeError("Give a reason for rejecting the export.");
    await decideExport(id(form, "orderId"), decision, staff.id, reason || undefined);
    return decision === "APPROVED" ? "Export approved; the order can ship." : "Export rejected; a full refund has been started.";
  }, { storefront: true });
}

export async function reprocessEventAction(_: ActionState, form: FormData) {
  return adminAction("payments.manage", async (staff) => {
    const status = await reprocessPaymentEvent(id(form, "eventId"), staff.id);
    return status === "FAILED" ? "Still failing; see the error on the event." : `Event ${status.toLowerCase()}.`;
  });
}

export async function runReconciliationAction(_: ActionState, form: FormData) {
  void form;
  return adminAction("jobs.run", async (staff) => {
    const result = await runReconciliationJob(`staff:${staff.email}`);
    return `Done: ${result.expiry.expired} expired, ${result.expiry.confirmed} confirmed late, ${result.events.processed} events recovered, ${result.payments.examined} payments checked.`;
  }, { storefront: true });
}
