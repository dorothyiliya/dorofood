import "server-only";
import { prisma } from "@/lib/prisma";
import { jsonSafe, lockOrder, recordAudit } from "@/lib/audit";
import { fulfilReservation } from "@/lib/inventory";
import { CommerceError } from "@/lib/commerce/errors";
import { requestRefund } from "@/lib/commerce/refunds";

export type CarrierShipmentRequest = {
  /** Must be forwarded to the carrier so a retried request cannot create two consignments. */
  idempotencyKey: string;
  orderNumber: string;
  destination: unknown;
  items: { sku: string; name: string; quantity: number }[];
};

export interface CarrierAdapter {
  code: string;
  createShipment(request: CarrierShipmentRequest): Promise<{ trackingNumber: string; trackingUrl?: string | null; serviceCode?: string | null; metadata?: Record<string, unknown> }>;
}

/** No carrier is integrated yet, so shipment creation fails closed. */
export function getConfiguredCarrier(): CarrierAdapter | null {
  return null;
}

const SHIPPABLE = ["CONFIRMED", "PROCESSING"];
const STALE_CREATING_MS = 5 * 60_000;

/**
 * Creates the carrier consignment for a paid order. A carrier failure leaves
 * the shipment FAILED and the order un-dispatched with its stock still
 * allocated, so the call can simply be retried.
 */
export async function createShipmentForOrder(orderId: string, carrier: CarrierAdapter | null = getConfiguredCarrier(), actorId = "system") {
  if (!carrier) throw new CommerceError("SHIPPING_PROVIDER_NOT_CONFIGURED", 503, "No shipping provider is configured.");
  const idempotencyKey = `${orderId}:primary`;

  const claim = await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) throw new CommerceError("ORDER_NOT_FOUND", 404, "Order not found.");
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, exportRecord: true, payments: { where: { status: "SUCCEEDED" } } } });
    if (!SHIPPABLE.includes(order.status) || order.payments.length === 0) {
      throw new CommerceError("ORDER_NOT_READY_FOR_SHIPMENT", 409, `Order is ${order.status}; only paid, confirmed orders can ship.`);
    }
    if (order.requiresExport && !["APPROVED", "CLEARED"].includes(order.exportRecord?.status ?? "")) {
      throw new CommerceError("EXPORT_NOT_APPROVED", 409, "Export review must approve this order before it ships.");
    }

    const existing = await tx.shipment.findUnique({ where: { idempotencyKey } });
    const retryable = !existing || existing.status === "QUOTE_PENDING" || existing.status === "FAILED"
      || (existing.status === "CREATING" && Date.now() - existing.updatedAt.getTime() > STALE_CREATING_MS);
    if (!retryable) return { order, shipment: existing!, claimed: false };

    const shipment = existing
      ? await tx.shipment.update({ where: { id: existing.id }, data: { status: "CREATING", attempts: { increment: 1 }, providerCode: carrier.code, failureReason: null } })
      : await tx.shipment.create({
          data: {
            orderId, idempotencyKey, status: "CREATING", attempts: 1, providerCode: carrier.code,
            destinationJson: jsonSafe(order.shippingAddressJson), shippingMinor: order.shippingMinor, currency: order.currency,
          },
        });
    if (order.status === "CONFIRMED") await tx.order.update({ where: { id: orderId }, data: { status: "PROCESSING" } });
    return { order, shipment, claimed: true };
  });
  if (!claim.claimed) return claim.shipment;

  try {
    const created = await carrier.createShipment({
      idempotencyKey,
      orderNumber: claim.order.orderNumber,
      destination: claim.order.shippingAddressJson,
      items: claim.order.items.map((i) => ({ sku: i.skuSnapshot, name: i.productNameSnapshot, quantity: i.quantity })),
    });
    return await prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.update({
        where: { id: claim.shipment.id },
        data: { status: "READY", trackingNumber: created.trackingNumber, trackingUrl: created.trackingUrl ?? null, serviceCode: created.serviceCode ?? null, providerMetadata: created.metadata ? jsonSafe(created.metadata) : undefined },
      });
      await tx.order.updateMany({ where: { id: orderId, status: "PROCESSING" }, data: { status: "READY_TO_DISPATCH" } });
      await recordAudit(tx, { action: "SHIPMENT_CREATED", entityType: "Order", entityId: orderId, actorId, metadata: { shipmentId: shipment.id, trackingNumber: created.trackingNumber } });
      return shipment;
    });
  } catch (error) {
    const message = (error as Error).message?.slice(0, 1000) || "Unknown carrier error";
    await prisma.$transaction(async (tx) => {
      await tx.shipment.update({ where: { id: claim.shipment.id }, data: { status: "FAILED", failureReason: message } });
      await recordAudit(tx, { action: "SHIPMENT_CREATION_FAILED", entityType: "Order", entityId: orderId, actorId, metadata: { message } });
    });
    throw new CommerceError("SHIPMENT_CREATION_FAILED", 502, "The carrier could not create the shipment. It can be retried.");
  }
}

/** Physical hand-over to the carrier: allocated stock leaves the location. */
export async function markShipmentDispatched(shipmentId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new CommerceError("SHIPMENT_NOT_FOUND", 404, "Shipment not found.");
    await lockOrder(tx, shipment.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: shipment.orderId }, include: { reservations: { where: { status: "COMMITTED" } } } });
    if (!["READY_TO_DISPATCH", "PROCESSING"].includes(order.status)) {
      throw new CommerceError("ORDER_NOT_DISPATCHABLE", 409, `Order is ${order.status}.`);
    }
    const moved = await tx.shipment.updateMany({ where: { id: shipmentId, status: { in: ["READY", "PACKED"] } }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
    if (moved.count !== 1) throw new CommerceError("SHIPMENT_NOT_READY", 409, "Shipment is not ready to dispatch.");
    for (const r of order.reservations) await fulfilReservation(tx, r, { reference: order.orderNumber, actorId });
    await tx.order.update({ where: { id: order.id }, data: { status: "DISPATCHED" } });
    await recordAudit(tx, { action: "ORDER_DISPATCHED", entityType: "Order", entityId: order.id, actorId, metadata: { shipmentId } });
  });
}

/** Export compliance decision. A rejection refunds the customer in full. */
export async function reviewExport(orderId: string, decision: "APPROVED" | "REJECTED", actorId: string, reason?: string) {
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const moved = await tx.exportRecord.updateMany({
      where: { orderId, status: { in: ["PENDING_REVIEW", "DOCUMENTS_PENDING"] } },
      data: { status: decision, reviewedBy: actorId, reviewedAt: new Date(), rejectionReason: decision === "REJECTED" ? reason ?? "Rejected" : null },
    });
    if (moved.count !== 1) throw new CommerceError("EXPORT_REVIEW_NOT_PENDING", 409, "There is no pending export review for this order.");
    await recordAudit(tx, { action: `EXPORT_${decision}`, entityType: "Order", entityId: orderId, actorId, metadata: { reason } });
  });
  if (decision === "REJECTED") {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (["CONFIRMED", "PROCESSING", "READY_TO_DISPATCH"].includes(order.status)) await requestRefund({ orderId, reason: "EXPORT_REJECTED", actorId, idempotencyKey: `export-rejected:${orderId}` });
  }
}
