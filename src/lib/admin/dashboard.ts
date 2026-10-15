import "server-only";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

const PAID = ["CONFIRMED", "PROCESSING", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED"] as const;

export type AttentionItem = { kind: string; title: string; detail: string; href: string };

export async function dashboardData() {
  const settings = await getSettings();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const staleShipping = new Date(Date.now() - 48 * 3_600_000);

  const [statusCounts, revenue, reviewOrders, refundIssues, failedEvents, failedShipments, exportReviews, unshipped, balances, recentOrders] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.groupBy({ by: ["currency"], where: { status: { in: [...PAID] }, confirmedAt: { gte: since } }, _sum: { totalMinor: true }, _count: { _all: true } }),
    prisma.order.findMany({ where: { status: "PAYMENT_REVIEW" }, select: { id: true, orderNumber: true }, take: 20 }),
    prisma.refund.findMany({ where: { OR: [{ providerCallState: "UNKNOWN" }, { status: "FAILED" }, { providerCallState: "NOT_SENT", status: "REFUND_PENDING" }] }, include: { payment: { select: { orderId: true, order: { select: { orderNumber: true } } } } }, take: 20 }),
    prisma.paymentEvent.count({ where: { status: "FAILED" } }),
    prisma.shipment.findMany({ where: { status: "FAILED" }, select: { orderId: true, failureReason: true, order: { select: { orderNumber: true } } }, take: 20 }),
    prisma.exportRecord.findMany({ where: { status: { in: ["PENDING_REVIEW", "DOCUMENTS_PENDING"] }, order: { status: { in: ["CONFIRMED", "PROCESSING"] } } }, select: { orderId: true, destinationCountry: true, order: { select: { orderNumber: true } } }, take: 20 }),
    prisma.order.findMany({ where: { status: "CONFIRMED", confirmedAt: { lt: staleShipping } }, select: { id: true, orderNumber: true }, take: 20 }),
    prisma.inventoryBalance.findMany({ where: { location: { code: settings["fulfilment.locationCode"] } }, include: { variant: { include: { product: true } } } }),
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, orderNumber: true, status: true, totalMinor: true, currency: true, createdAt: true, email: true } }),
  ]);

  const lowStock = balances
    .filter((b) => b.variant.status === "ACTIVE" && b.quantityOnHand - b.reservedQuantity <= settings["inventory.lowStockThreshold"])
    .map((b) => ({ variantId: b.variantId, productId: b.variant.productId, name: b.variant.product.name, sku: b.variant.sku, sellable: b.quantityOnHand - b.reservedQuantity }))
    .sort((a, b) => a.sellable - b.sellable);

  const attention: AttentionItem[] = [
    ...reviewOrders.map((o) => ({ kind: "Payment review", title: o.orderNumber, detail: "Payment did not match the order total.", href: `/admin/orders/${o.id}` })),
    ...refundIssues.map((r) => ({
      kind: "Refund", title: r.payment.order.orderNumber,
      detail: r.providerCallState === "UNKNOWN" ? "Outcome unknown: check Paystack, then record the result." : r.status === "FAILED" ? "Refund failed: customer has not been repaid." : "Refund not sent yet (payment credentials missing?).",
      href: `/admin/orders/${r.payment.orderId}`,
    })),
    ...(failedEvents ? [{ kind: "Webhooks", title: `${failedEvents} failed event(s)`, detail: "Payment notifications that could not be processed.", href: "/admin/payments?tab=events&status=FAILED" }] : []),
    ...failedShipments.map((s) => ({ kind: "Shipment", title: s.order.orderNumber, detail: `Shipment creation failed: ${s.failureReason ?? "unknown"}`, href: `/admin/orders/${s.orderId}` })),
    ...exportReviews.map((e) => ({ kind: "Export review", title: e.order.orderNumber, detail: `Awaiting export approval to ${e.destinationCountry}.`, href: `/admin/orders/${e.orderId}` })),
    ...unshipped.map((o) => ({ kind: "Fulfilment", title: o.orderNumber, detail: "Paid more than 48 hours ago and not shipped.", href: `/admin/orders/${o.id}` })),
  ];

  return {
    counts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])) as Record<string, number>,
    revenue: revenue.map((r) => ({ currency: r.currency, totalMinor: r._sum.totalMinor ?? BigInt(0), orders: r._count._all })),
    attention,
    lowStock,
    lowStockThreshold: settings["inventory.lowStockThreshold"],
    recentOrders,
    settings,
  };
}
