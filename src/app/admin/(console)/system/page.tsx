import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { systemStatus } from "@/lib/admin/system";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, DateTime, Notice, PageHeader, StatusBadge, Table, td } from "@/app/admin/_components/ui";
import { runReconciliationAction } from "@/app/admin/actions/orders";

export const metadata = { title: "Health check" };

export default async function SystemPage() {
  const staff = await requireStaffPage();
  const status = await systemStatus();

  return (
    <>
      <PageHeader title="Health check" description={`Whether everything the shop relies on is set up and working (${status.deployment}). For whoever looks after the website.`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Configuration">
          <ul className="space-y-3 text-sm">
            {[status.database, ...status.env].map((c) => (
              <li key={c.label} className="flex items-start justify-between gap-4">
                <div><div className="font-medium">{c.label}</div><div className="text-xs text-slate-600">{c.detail}</div></div>
                <StatusBadge status={c.ok ? "OK" : "Missing"} tone={c.ok ? "good" : "warning"} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Checkout">
          {status.checkout.live ? <Notice tone="good">Live: customers can order and pay.</Notice> : (
            <Notice tone="warning"><strong>Not live.</strong><ul className="mt-1 list-disc pl-4">{status.checkout.reasons.map((r) => <li key={r}>{r}</li>)}</ul></Notice>
          )}
          <p className="mt-4 text-sm text-slate-600">Environment variables are set in the Vercel project (Settings → Environment Variables) and take effect on the next deployment. Store-level switches are in Store settings and apply immediately.</p>
        </Card>
        <Card title="Reconciliation job" description="Retries failed payment notifications, checks unconfirmed payments with the payment provider, releases stock from expired checkouts and sends pending refunds." className="xl:col-span-2"
          actions={can(staff.role, "jobs.run") && <ActionForm action={runReconciliationAction} submitLabel="Run now" variant="secondary" />}>
          <Table head={["Started", "Trigger", "Status", "Result"]} empty="No runs recorded yet. On Vercel's Hobby plan cron runs at most once a day; run it here or use an external scheduler.">
            {status.jobs.map((j) => (
              <tr key={j.id}>
                <td className={td}><DateTime value={j.startedAt} /></td>
                <td className={`${td} text-xs`}>{j.triggeredBy}</td>
                <td className={td}><StatusBadge status={j.status} /></td>
                <td className={`${td} max-w-xl`}><pre className="whitespace-pre-wrap text-xs text-slate-600">{j.error ?? JSON.stringify(j.resultJson)}</pre></td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
