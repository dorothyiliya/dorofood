import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { Card, DateTime, PageHeader, Pagination, Table, humanise, inputClass, pageParam, stringParam, td } from "@/app/admin/_components/ui";

export const metadata = { title: "Audit log" };
const PAGE_SIZE = 100;

const ENTITY_LINKS: Record<string, (id: string) => string> = {
  Order: (id) => `/admin/orders/${id}`,
  Product: (id) => `/admin/catalogue/${id}`,
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const page = pageParam(params.page);
  const action = stringParam(params.action, 60).toUpperCase();
  const actor = stringParam(params.actor, 64);
  const where: Prisma.AuditEventWhereInput = { ...(action ? { action: { contains: action } } : {}), ...(actor ? { actorId: actor } : {}) };
  const [events, staff, actions] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 }),
    prisma.staffUser.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.auditEvent.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  const names = new Map(staff.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader title="Audit log" description="An append-only record of every change: who, what and when." />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-3">
          <select name="action" defaultValue={action} aria-label="Action" className={`${inputClass} sm:!w-64`}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a.action} value={a.action}>{humanise(a.action)}</option>)}
          </select>
          <select name="actor" defaultValue={actor} aria-label="Who" className={`${inputClass} sm:!w-56`}>
            <option value="">Everyone</option>
            <option value="system">System</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white">Filter</button>
        </form>
        <Table head={["When", "Who", "Action", "Record", "Details"]} empty="No matching events.">
          {events.slice(0, PAGE_SIZE).map((e) => {
            const link = ENTITY_LINKS[e.entityType]?.(e.entityId);
            return (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap`}><DateTime value={e.createdAt} /></td>
                <td className={td}>{!e.actorId || e.actorId === "system" ? "System" : names.get(e.actorId) ?? e.actorId}</td>
                <td className={`${td} font-medium`}>{humanise(e.action)}</td>
                <td className={`${td} text-xs`}>{link ? <Link className="text-brand-800 hover:underline" href={link}>{e.entityType}</Link> : e.entityType} <span className="font-mono text-slate-500">{e.entityId.slice(0, 12)}</span></td>
                <td className={`${td} max-w-md`}>{e.metadata ? <details><summary className="cursor-pointer text-xs text-slate-600">View</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{JSON.stringify(e.metadata, null, 2)}</pre></details> : null}</td>
              </tr>
            );
          })}
        </Table>
        <Pagination page={page} hasNext={events.length > PAGE_SIZE} href={(n) => `/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(actor ? { actor } : {}), page: String(n) })}`} />
      </Card>
    </>
  );
}
