import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import type { PaymentEventStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, DateTime, Money, PageHeader, Pagination, StatusBadge, Table, Tabs, humanise, inputClass, pageParam, td } from "@/app/admin/_components/ui";
import { reprocessEventAction } from "@/app/admin/actions/orders";

export const metadata = { title: "Payments" };
const PAGE_SIZE = 50;
const PAYMENT_STATUSES: PaymentStatus[] = ["INITIATED", "PENDING", "SUCCEEDED", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"];
const EVENT_STATUSES: PaymentEventStatus[] = ["RECEIVED", "PROCESSED", "IGNORED", "FAILED"];

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const staff = await requireStaffPage();
  const tab = params.tab === "events" ? "events" : "transactions";
  const page = pageParam(params.page);

  return (
    <>
      <PageHeader title="Payments" description="Payment attempts with every gateway (Whop, Paystack) and the webhook notifications they sent." />
      <Tabs active={tab} tabs={[{ key: "transactions", label: "Transactions", href: "/admin/payments" }, { key: "events", label: "Webhook events", href: "/admin/payments?tab=events" }]} />
      {tab === "transactions" ? <Transactions page={page} status={PAYMENT_STATUSES.find((s) => s === params.status)} /> : <Events page={page} status={EVENT_STATUSES.find((s) => s === params.status)} canReprocess={can(staff.role, "payments.manage")} />}
    </>
  );
}

function StatusFilter({ tab, options, value }: { tab: string; options: string[]; value?: string }) {
  return (
    <form className="mb-4 flex items-end gap-3">
      {tab === "events" && <input type="hidden" name="tab" value="events" />}
      <select name="status" defaultValue={value ?? ""} className={`${inputClass} sm:!w-56`} aria-label="Status">
        <option value="">All statuses</option>
        {options.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
      </select>
      <button className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white">Filter</button>
    </form>
  );
}

async function Transactions({ page, status }: { page: number; status?: PaymentStatus }) {
  const rows = await prisma.paymentTransaction.findMany({
    where: status ? { status } : {}, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
    include: { order: { select: { id: true, orderNumber: true } } },
  });
  return (
    <Card>
      <StatusFilter tab="transactions" options={PAYMENT_STATUSES} value={status} />
      <Table head={["Created", "Order", "Reference", "Status", "Expected", "Received", "Verified"]} empty="No payments yet.">
        {rows.slice(0, PAGE_SIZE).map((p) => (
          <tr key={p.id}>
            <td className={td}><DateTime value={p.createdAt} /></td>
            <td className={td}><Link className="text-brand-800 hover:underline" href={`/admin/orders/${p.order.id}`}>{p.order.orderNumber}</Link></td>
            <td className={`${td} font-mono text-xs`}>{p.providerReference}</td>
            <td className={td}><StatusBadge status={p.status} /></td>
            <td className={`${td} text-right`}><Money minor={p.amountMinor} currency={p.currency} /></td>
            <td className={`${td} text-right`}><Money minor={p.receivedAmountMinor} currency={p.receivedCurrency ?? p.currency} /></td>
            <td className={td}><DateTime value={p.verifiedAt} /></td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} hasNext={rows.length > PAGE_SIZE} href={(n) => `/admin/payments?${new URLSearchParams({ ...(status ? { status } : {}), page: String(n) })}`} />
    </Card>
  );
}

async function Events({ page, status, canReprocess }: { page: number; status?: PaymentEventStatus; canReprocess: boolean }) {
  const rows = await prisma.paymentEvent.findMany({ where: status ? { status } : {}, orderBy: { receivedAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 });
  return (
    <Card description="Each signed notification is stored once. Failed ones are retried by the reconciliation job, or here.">
      <StatusFilter tab="events" options={EVENT_STATUSES} value={status} />
      <Table head={["Received", "Event", "Reference", "Status", "Attempts", "Last error", ""]} empty="No webhook events yet.">
        {rows.slice(0, PAGE_SIZE).map((e) => (
          <tr key={e.id}>
            <td className={td}><DateTime value={e.receivedAt} /></td>
            <td className={`${td} font-mono text-xs`}>{e.eventType}</td>
            <td className={`${td} font-mono text-xs`}>{e.reference ?? "-"}</td>
            <td className={td}><StatusBadge status={e.status} /></td>
            <td className={`${td} tabular-nums`}>{e.attempts}</td>
            <td className={`${td} max-w-xs text-xs text-red-700`}>{e.lastError ?? ""}</td>
            <td className={td}>{canReprocess && (e.status === "FAILED" || e.status === "RECEIVED") && <ActionForm action={reprocessEventAction} hidden={{ eventId: e.id }} submitLabel="Retry" variant="secondary" />}</td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} hasNext={rows.length > PAGE_SIZE} href={(n) => `/admin/payments?${new URLSearchParams({ tab: "events", ...(status ? { status } : {}), page: String(n) })}`} />
    </Card>
  );
}
