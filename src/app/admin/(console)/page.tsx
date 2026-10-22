import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { dashboardData, setupSteps, type SetupStep } from "@/lib/admin/dashboard";
import { CheckCircle, Circle } from "@phosphor-icons/react/dist/ssr";
import { systemStatus } from "@/lib/admin/system";
import { formatMoney } from "@/lib/money";
import { Card, DateTime, Money, Notice, PageHeader, StatusBadge, Table, td } from "@/app/admin/_components/ui";

export const metadata = { title: "Home" };

function GettingStarted({ steps }: { steps: SetupStep[] }) {
  const left = steps.filter((s) => !s.done).length;
  return (
    <section className="mb-6 rounded-xl border border-brand-200 bg-brand-50/60 p-5" aria-labelledby="getting-started">
      <h2 id="getting-started" className="text-lg font-semibold text-slate-900">Get your shop ready</h2>
      <p className="mt-1 text-sm text-slate-600">{left === 1 ? "One more step" : `${left} steps`} before customers can buy. This list disappears when everything is done.</p>
      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              {s.done ? <CheckCircle size={24} weight="fill" className="shrink-0 text-brand-700" aria-hidden="true" /> : <Circle size={24} className="shrink-0 text-slate-300" aria-hidden="true" />}
              <div>
                <div className={`font-medium ${s.done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900"}`}><span className="sr-only">{s.done ? "Done: " : "To do: "}</span>{i + 1}. {s.title}</div>
                <div className="text-sm text-slate-600">{s.detail}</div>
              </div>
            </div>
            {!s.done && <Link href={s.href} className="rounded-md bg-brand-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-900">{s.action}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Stat({ label, value, href, hint }: { label: string; value: number; href: string; hint?: string }) {
  return (
    <Link href={href} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-slate-900">{value.toLocaleString("en-NG")}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Link>
  );
}

export default async function DashboardPage() {
  const [data, status, steps] = await Promise.all([dashboardData(), systemStatus(), setupSteps()]);
  const settingUp = steps.some((s) => !s.done);
  const c = (s: string) => data.counts[s] ?? 0;
  const [lead, ...otherCurrencies] = data.revenue;

  return (
    <>
      <PageHeader title="Home" description="What needs doing today, and how the shop is doing." />

      {settingUp && <GettingStarted steps={steps} />}

      {!settingUp && !status.checkout.live && (
        <div className="mb-6">
          <Notice tone="warning">
            <strong>The shop is not taking orders.</strong> {status.checkout.reasons.join(" ")}{" "}
            <Link href="/admin/system" className="underline">See the health check</Link>.
          </Notice>
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1.2fr_2fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-600">Paid revenue, last 30 days</div>
          <div className="mt-2 text-5xl font-semibold tracking-tight text-slate-900">{lead ? formatMoney(lead.totalMinor, lead.currency) : formatMoney(0, "NGN")}</div>
          <div className="mt-2 text-sm text-slate-500">
            {lead ? `${lead.orders} paid order${lead.orders === 1 ? "" : "s"}` : "No paid orders yet"}
            {otherCurrencies.map((r) => <span key={r.currency}> · {formatMoney(r.totalMinor, r.currency)} ({r.orders})</span>)}
          </div>
        </section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Awaiting payment" value={c("PENDING_PAYMENT")} href="/admin/orders?status=PENDING_PAYMENT" />
          <Stat label="To pack and send" value={c("CONFIRMED") + c("PROCESSING") + c("READY_TO_DISPATCH")} href="/admin/orders?status=CONFIRMED" />
          <Stat label="Needs attention" value={data.attention.length} href="#attention" />
          <Stat label="Running low" value={data.lowStock.length} href="/admin/inventory" hint={`${data.lowStockThreshold} or fewer left`} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Needs attention" description="Money or customers are waiting on a decision." className="xl:col-span-2">
          <div id="attention" />
          {data.attention.length === 0 ? <p className="text-sm text-slate-500">Nothing needs attention.</p> : (
            <ul className="divide-y divide-slate-100">
              {data.attention.map((item, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div><StatusBadge status={item.kind} tone="warning" /> <span className="ml-2 font-medium">{item.title}</span> <span className="ml-2 text-slate-600">{item.detail}</span></div>
                  <Link href={item.href} className="font-medium text-brand-800 hover:underline">Open →</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent orders" actions={<Link href="/admin/orders" className="text-sm text-brand-800 hover:underline">All orders →</Link>}>
          <Table head={["Order", "Customer", "Status", "Total"]} empty="No orders yet.">
            {data.recentOrders.map((o) => (
              <tr key={o.id}>
                <td className={td}><Link href={`/admin/orders/${o.id}`} className="font-medium text-brand-800 hover:underline">{o.orderNumber}</Link><div className="text-xs text-slate-500"><DateTime value={o.createdAt} /></div></td>
                <td className={`${td} max-w-[180px] truncate`}>{o.email}</td>
                <td className={td}><StatusBadge status={o.status} /></td>
                <td className={`${td} text-right`}><Money minor={o.totalMinor} currency={o.currency} /></td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Running low" description={`Products with ${data.lowStockThreshold} or fewer left to sell.`} actions={<Link href="/admin/inventory" className="text-sm text-brand-800 hover:underline">Stock →</Link>}>
          <Table head={["Product", "SKU", "Sellable"]} empty="Stock levels look fine.">
            {data.lowStock.slice(0, 10).map((s) => (
              <tr key={s.variantId}>
                <td className={td}><Link href={`/admin/catalogue/${s.productId}`} className="hover:underline">{s.name}</Link></td>
                <td className={`${td} font-mono text-xs`}>{s.sku}</td>
                <td className={`${td} tabular-nums`}>{s.sellable <= 0 ? <StatusBadge status="Out of stock" tone="critical" /> : s.sellable}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
