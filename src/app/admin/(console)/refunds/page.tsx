import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Card, DateTime, Money, Notice, PageHeader, Pagination, StatusBadge, Table, Tabs, pageParam, td } from "@/app/admin/_components/ui";

export const metadata = { title: "Refunds" };
const PAGE_SIZE = 50;

const VIEWS: Record<string, { label: string; where: Prisma.RefundWhereInput }> = {
  attention: { label: "Needs attention", where: { OR: [{ providerCallState: "UNKNOWN" }, { status: "FAILED" }, { status: "REFUND_PENDING", providerCallState: "NOT_SENT" }] } },
  pending: { label: "In progress", where: { status: "REFUND_PENDING" } },
  all: { label: "All", where: {} },
};

export default async function RefundsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const view = typeof params.view === "string" && params.view in VIEWS ? params.view : "attention";
  const page = pageParam(params.page);
  const rows = await prisma.refund.findMany({
    where: VIEWS[view].where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
    include: { payment: { select: { providerReference: true, order: { select: { id: true, orderNumber: true } } } } },
  });

  return (
    <>
      <PageHeader title="Refunds" description="Refunds are issued from an order. Resolve unknown or failed ones from the order page." />
      <div className="mb-4">
        <Notice>A refund marked <strong>Unknown</strong> was sent to Paystack but no answer came back. It is never retried automatically, because that could repay the customer twice. Check it in the Paystack dashboard, then record the outcome on the order.</Notice>
      </div>
      <Tabs active={view} tabs={Object.entries(VIEWS).map(([key, v]) => ({ key, label: v.label, href: `/admin/refunds?view=${key}` }))} />
      <Card>
        <Table head={["Requested", "Order", "Amount", "Status", "Provider", "Reason", "By"]} empty="No refunds in this view.">
          {rows.slice(0, PAGE_SIZE).map((r) => (
            <tr key={r.id}>
              <td className={td}><DateTime value={r.createdAt} /></td>
              <td className={td}><Link className="text-brand-800 hover:underline" href={`/admin/orders/${r.payment.order.id}`}>{r.payment.order.orderNumber}</Link></td>
              <td className={`${td} text-right`}><Money minor={r.amountMinor} currency={r.currency} /></td>
              <td className={td}><StatusBadge status={r.status} /></td>
              <td className={td}><StatusBadge status={r.providerCallState} /></td>
              <td className={`${td} max-w-xs text-xs`}>{r.reason}{r.failureReason && <div className="text-red-700">{r.failureReason}</div>}</td>
              <td className={`${td} text-xs`}>{r.requestedBy}</td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} hasNext={rows.length > PAGE_SIZE} href={(n) => `/admin/refunds?view=${view}&page=${n}`} />
      </Card>
    </>
  );
}
