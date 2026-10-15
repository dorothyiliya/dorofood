import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Card, DateTime, Money, PageHeader, Pagination, StatusBadge, Table, inputClass, pageParam, stringParam, td, humanise } from "@/app/admin/_components/ui";

export const metadata = { title: "Orders" };
const PAGE_SIZE = 50;
const STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "PAYMENT_REVIEW", "CONFIRMED", "PROCESSING", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "CANCELLED", "REFUND_PENDING", "REFUNDED"];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const page = pageParam(params.page);
  const q = stringParam(params.q);
  const status = STATUSES.find((s) => s === params.status);
  const where: Prisma.OrderWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ orderNumber: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { payments: { some: { providerReference: q } } }] } : {}),
  };
  const orders = await prisma.order.findMany({
    where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
    include: { market: { select: { code: true } }, _count: { select: { items: true } } },
  });
  const href = (p: number) => `/admin/orders?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Orders" description="Every order, its payment and fulfilment state. Open one to act on it." />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Search</span>
            <input name="q" defaultValue={q} placeholder="Order number, email or payment reference" className={`${inputClass} sm:!w-80`} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Status</span>
            <select name="status" defaultValue={status ?? ""} className={inputClass}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
            </select>
          </label>
          <button className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white">Filter</button>
          {(q || status) && <Link href="/admin/orders" className="text-sm text-slate-600 hover:underline">Clear</Link>}
        </form>
        <Table head={["Order", "Placed", "Customer", "Destination", "Items", "Status", "Total"]} empty="No orders match.">
          {orders.slice(0, PAGE_SIZE).map((o) => (
            <tr key={o.id} className="hover:bg-slate-50">
              <td className={td}><Link href={`/admin/orders/${o.id}`} className="font-medium text-brand-800 hover:underline">{o.orderNumber}</Link></td>
              <td className={`${td} whitespace-nowrap`}><DateTime value={o.createdAt} /></td>
              <td className={`${td} max-w-[220px] truncate`}>{o.email}</td>
              <td className={td}>{o.destinationCountry} <span className="text-xs text-slate-500">({o.market.code})</span>{o.requiresExport && <span className="ml-1 text-xs text-amber-700">export</span>}</td>
              <td className={`${td} tabular-nums`}>{o._count.items}</td>
              <td className={td}><StatusBadge status={o.status} /></td>
              <td className={`${td} text-right`}><Money minor={o.totalMinor} currency={o.currency} /></td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} hasNext={orders.length > PAGE_SIZE} href={href} />
      </Card>
    </>
  );
}
