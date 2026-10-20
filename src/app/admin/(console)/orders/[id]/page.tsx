import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { paidAmount } from "@/lib/commerce/refunds";
import { minorToInput } from "@/lib/money";
import { providerName } from "@/lib/integrations/definitions";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, DateTime, Field, KeyValues, Money, Notice, PageHeader, Select, StatusBadge, Table, inputClass, td, humanise } from "@/app/admin/_components/ui";
import {
  cancelOrderAction, deliveredAction, dispatchAction, exportDecisionAction, manualShipmentAction, refundAction,
  resolveRefundAction, resolveReviewAction, verifyPaymentAction,
} from "@/app/admin/actions/orders";

export const metadata = { title: "Order" };

const PAID = ["CONFIRMED", "PROCESSING", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "REFUND_PENDING", "PAYMENT_REVIEW"];

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaffPage();
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      market: true, items: true, exportRecord: true,
      reservations: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "asc" }, include: { refunds: { orderBy: { createdAt: "asc" } } } },
      shipments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

  const refundIds = order.payments.flatMap((p) => p.refunds.map((r) => r.id));
  const timeline = await prisma.auditEvent.findMany({ where: { OR: [{ entityId: order.id }, { entityId: { in: refundIds } }] }, orderBy: { createdAt: "asc" } });
  const actorIds = [...new Set(timeline.map((t) => t.actorId).filter((a): a is string => !!a && a !== "system"))];
  const actors = new Map((await prisma.staffUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));

  const address = order.shippingAddressJson as Record<string, string | undefined>;
  const succeeded = order.payments.filter((p) => ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"].includes(p.status));
  const refundable = succeeded.reduce((sum, p) => sum + paidAmount(p) - p.refunds.filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountMinor, BigInt(0)), BigInt(0));
  const exportOk = !order.requiresExport || ["APPROVED", "CLEARED"].includes(order.exportRecord?.status ?? "");
  const shipment = order.shipments.at(-1);
  const perm = { manage: can(staff.role, "orders.manage"), fulfil: can(staff.role, "orders.fulfil"), refunds: can(staff.role, "refunds.manage") };

  return (
    <>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={order.status} /> Placed <DateTime value={order.createdAt} /> · {order.market.name}</span>}
        actions={<Link href="/admin/orders" className="text-sm text-slate-600 hover:underline">← All orders</Link>}
      />

      {order.status === "PAYMENT_REVIEW" && <div className="mb-4"><Notice tone="critical">The payment received does not match this order. Decide below whether to accept it or refund it.</Notice></div>}
      {order.requiresExport && !exportOk && PAID.includes(order.status) && <div className="mb-4"><Notice tone="warning">This is an export order. It cannot ship until export review approves it.</Notice></div>}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card title="Items">
            <Table head={["Product", "SKU", "Qty", "Unit", "Line total"]}>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td className={td}>{i.productNameSnapshot} <span className="text-xs text-slate-500">{i.packSizeSnapshot}</span></td>
                  <td className={`${td} font-mono text-xs`}>{i.skuSnapshot}</td>
                  <td className={`${td} tabular-nums`}>{i.quantity}</td>
                  <td className={`${td} text-right`}><Money minor={i.unitPriceMinor} currency={order.currency} /></td>
                  <td className={`${td} text-right`}><Money minor={i.lineTotalMinor} currency={order.currency} /></td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 ml-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><Money minor={order.subtotalMinor} currency={order.currency} /></div>
              <div className="flex justify-between"><span className="text-slate-600">Delivery</span><Money minor={order.shippingMinor} currency={order.currency} /></div>
              <div className="flex justify-between font-semibold"><span>Total</span><Money minor={order.totalMinor} currency={order.currency} /></div>
            </div>
          </Card>

          <Card title="Payments" description="Status comes only from the payment provider's verification API.">
            <Table head={["Reference", "Status", "Expected", "Received", "Verified", ""]} empty="No payment attempts.">
              {order.payments.map((p) => (
                <tr key={p.id}>
                  <td className={`${td} font-mono text-xs`}>{p.providerReference}</td>
                  <td className={td}><StatusBadge status={p.status} />{p.failureReason && <div className="mt-1 max-w-xs text-xs text-red-700">{p.failureReason}</div>}</td>
                  <td className={`${td} text-right`}><Money minor={p.amountMinor} currency={p.currency} /></td>
                  <td className={`${td} text-right`}><Money minor={p.receivedAmountMinor} currency={p.receivedCurrency ?? p.currency} /></td>
                  <td className={td}><DateTime value={p.verifiedAt} /></td>
                  <td className={td}>{perm.manage && ["INITIATED", "PENDING", "FAILED"].includes(p.status) && <ActionForm action={verifyPaymentAction} hidden={{ paymentId: p.id }} submitLabel={`Check with ${providerName(p.provider)}`} variant="secondary" />}</td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Refunds">
            <Table head={["Requested", "Amount", "Status", "Provider", "Reason", ""]} empty="No refunds.">
              {order.payments.flatMap((p) => p.refunds.map((r) => (
                <tr key={r.id}>
                  <td className={td}><DateTime value={r.createdAt} /></td>
                  <td className={`${td} text-right`}><Money minor={r.amountMinor} currency={r.currency} /></td>
                  <td className={td}><StatusBadge status={r.status} /></td>
                  <td className={td}><StatusBadge status={r.providerCallState} />{r.providerRef && <div className="text-xs text-slate-500">#{r.providerRef}</div>}</td>
                  <td className={`${td} max-w-xs text-xs`}>{r.reason}{r.failureReason && <div className="text-red-700">{r.failureReason}</div>}</td>
                  <td className={`${td} min-w-[260px]`}>
                    {perm.refunds && r.status === "REFUND_PENDING" && r.providerCallState !== "SENT" && (
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-brand-800">Record outcome…</summary>
                        <ActionForm action={resolveRefundAction} hidden={{ refundId: r.id }} submitLabel="Record" className="mt-2" confirm={`I checked this refund in the ${providerName(p.provider)} dashboard.`}>
                          <Field label="Outcome"><Select name="outcome" options={[["REFUNDED", `Refunded in ${providerName(p.provider)}`], ["FAILED", "Not refunded / failed"]]} /></Field>
                          <Field label={`${providerName(p.provider)} refund ID (optional)`}><input name="providerRef" className={inputClass} /></Field>
                          <Field label="Note"><input name="note" required className={inputClass} /></Field>
                        </ActionForm>
                      </details>
                    )}
                  </td>
                </tr>
              )))}
            </Table>
          </Card>

          <Card title="Shipping">
            <Table head={["Created", "Carrier", "Tracking", "Status", "Attempts", ""]} empty="No shipment yet.">
              {order.shipments.map((s) => (
                <tr key={s.id}>
                  <td className={td}><DateTime value={s.createdAt} /></td>
                  <td className={td}>{s.providerCode?.replace(/^MANUAL:/, "") ?? "-"}</td>
                  <td className={`${td} font-mono text-xs`}>{s.trackingUrl ? <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="text-brand-800 hover:underline">{s.trackingNumber}</a> : s.trackingNumber ?? "-"}</td>
                  <td className={td}><StatusBadge status={s.status} />{s.failureReason && <div className="mt-1 text-xs text-red-700">{s.failureReason}</div>}</td>
                  <td className={`${td} tabular-nums`}>{s.attempts}</td>
                  <td className={td}>
                    {perm.fulfil && ["READY", "PACKED"].includes(s.status) && <ActionForm action={dispatchAction} hidden={{ shipmentId: s.id }} submitLabel="Mark dispatched" confirm="The parcel has left with the carrier." />}
                    {perm.fulfil && ["DISPATCHED", "IN_TRANSIT", "CUSTOMS_HOLD"].includes(s.status) && <ActionForm action={deliveredAction} hidden={{ shipmentId: s.id }} submitLabel="Mark delivered" variant="secondary" />}
                  </td>
                </tr>
              ))}
            </Table>
            {perm.fulfil && ["CONFIRMED", "PROCESSING"].includes(order.status) && exportOk && (!shipment || ["FAILED", "QUOTE_PENDING"].includes(shipment.status)) && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-sm font-semibold">Create shipment</h3>
                <ActionForm action={manualShipmentAction} hidden={{ orderId: order.id }} submitLabel="Create shipment" inline>
                  <Field label="Carrier"><input name="carrier" required placeholder="e.g. GIG Logistics" className={inputClass} /></Field>
                  <Field label="Tracking number"><input name="trackingNumber" required className={inputClass} /></Field>
                  <Field label="Tracking link (optional)"><input name="trackingUrl" type="url" placeholder="https://" className={inputClass} /></Field>
                </ActionForm>
              </div>
            )}
          </Card>

          <Card title="Timeline" description="Every change to this order, with who made it.">
            <ol className="space-y-2 text-sm">
              {timeline.map((t) => (
                <li key={t.id} className="flex flex-wrap gap-x-3">
                  <span className="w-40 shrink-0 text-slate-500"><DateTime value={t.createdAt} /></span>
                  <span className="font-medium">{humanise(t.action)}</span>
                  <span className="text-slate-500">by {t.actorId === "system" || !t.actorId ? "system" : actors.get(t.actorId) ?? t.actorId}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Customer & delivery">
            <KeyValues items={[
              ["Email", order.email],
              ["Phone", order.phone ?? address.phone ?? "-"],
              ["Recipient", address.recipient ?? "-"],
              ["Address", [address.line1, address.line2, address.city, address.region, address.postalCode, address.countryCode].filter(Boolean).join(", ")],
              ["Note", order.customerNote ?? "-"],
              ["Pay by", <DateTime key="p" value={order.paymentExpiresAt} />],
            ]} />
          </Card>

          {order.exportRecord && (
            <Card title="Export review">
              <div className="mb-3"><StatusBadge status={order.exportRecord.status} /> <span className="ml-1 text-sm">to {order.exportRecord.destinationCountry}</span></div>
              {order.exportRecord.rejectionReason && <p className="mb-3 text-sm text-red-700">{order.exportRecord.rejectionReason}</p>}
              {perm.fulfil && ["PENDING_REVIEW", "DOCUMENTS_PENDING"].includes(order.exportRecord.status) && (
                <div className="space-y-4">
                  <ActionForm action={exportDecisionAction} hidden={{ orderId: order.id, decision: "APPROVED" }} submitLabel="Approve export" confirm="Every item may legally be exported to this destination." />
                  <ActionForm action={exportDecisionAction} hidden={{ orderId: order.id, decision: "REJECTED" }} submitLabel="Reject and refund" variant="danger">
                    <Field label="Reason"><input name="reason" required className={inputClass} /></Field>
                  </ActionForm>
                </div>
              )}
            </Card>
          )}

          {order.status === "PAYMENT_REVIEW" && (perm.manage || perm.refunds) && (
            <Card title="Resolve payment review">
              <div className="space-y-4">
                {perm.manage && (
                  <ActionForm action={resolveReviewAction} hidden={{ orderId: order.id, decision: "ACCEPT" }} submitLabel="Accept payment and confirm">
                    <Field label="Why accept?"><input name="note" required className={inputClass} /></Field>
                  </ActionForm>
                )}
                {perm.refunds && (
                  <ActionForm action={resolveReviewAction} hidden={{ orderId: order.id, decision: "REFUND" }} submitLabel="Refund what was paid" variant="danger" confirm="Refund the amount actually received and close the order.">
                    <Field label="Note"><input name="note" required className={inputClass} /></Field>
                  </ActionForm>
                )}
              </div>
            </Card>
          )}

          {perm.manage && order.status === "PENDING_PAYMENT" && (
            <Card title="Cancel order" description="Releases the reserved stock. If the customer pays later, they are refunded automatically.">
              <ActionForm action={cancelOrderAction} hidden={{ orderId: order.id }} submitLabel="Cancel order" variant="danger" confirm="Cancel this unpaid order.">
                <Field label="Reason"><input name="reason" required className={inputClass} /></Field>
              </ActionForm>
            </Card>
          )}

          {perm.refunds && refundable > BigInt(0) && order.status !== "PAYMENT_REVIEW" && (
            <Card title="Refund" description={<>Up to <Money minor={refundable} currency={order.currency} /> can be refunded. A full refund before dispatch cancels the order and returns its stock.</>}>
              <ActionForm action={refundAction} hidden={{ orderId: order.id, idempotencyKey: randomUUID() }} submitLabel="Issue refund" variant="danger" confirm={`Send this refund to the customer through ${providerName(succeeded[0]?.provider)}.`}>
                <Field label="Amount" help="Leave empty to refund everything remaining."><input name="amount" inputMode="decimal" placeholder={minorToInput(refundable)} className={inputClass} /></Field>
                <Field label="Reason"><input name="reason" required className={inputClass} /></Field>
              </ActionForm>
            </Card>
          )}

          <Card title="Stock held">
            <Table head={["Variant", "Qty", "Status"]} empty="No stock held.">
              {order.reservations.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} font-mono text-xs`}>{order.items.find((i) => i.variantId === r.variantId)?.skuSnapshot ?? r.variantId}</td>
                  <td className={`${td} tabular-nums`}>{r.quantity}</td>
                  <td className={td}><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
