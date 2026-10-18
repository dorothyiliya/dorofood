import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { getAppBaseUrl } from "@/lib/env";
import { canEncrypt, hint } from "@/lib/integrations/crypto";
import { CATEGORY_LABELS, INTEGRATIONS, type FieldDef, type IntegrationDef } from "@/lib/integrations/definitions";
import { getAllIntegrations, type ResolvedIntegration } from "@/lib/integrations/store";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, DateTime, Field, Notice, PageHeader, StatusBadge, inputClass } from "@/app/admin/_components/ui";
import { saveIntegrationAction, testIntegrationAction } from "@/app/admin/actions/integrations";

export const metadata = { title: "Integrations" };

function shopOrigin() {
  try { return getAppBaseUrl(); } catch { return null; }
}

export default async function IntegrationsPage() {
  const staff = await requireStaffPage();
  const editable = can(staff.role, "settings.manage");
  const [resolved, markets] = await Promise.all([getAllIntegrations(), prisma.market.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true, status: true, paymentProvider: true } })]);
  const byKey = new Map(resolved.map((r) => [r.key, r]));
  const origin = shopOrigin();
  const encryption = canEncrypt();
  const categories = [...new Set(INTEGRATIONS.map((d) => d.category))];

  return (
    <>
      <PageHeader title="Integrations" description="Connect payment gateways, AI, email and photo storage. Saved secrets are encrypted and never shown again; only their last four characters are displayed. An environment variable set in Vercel always wins over a value saved here." />
      {!encryption && (
        <div className="mb-6">
          <Notice tone="warning"><strong>Secrets can&apos;t be saved here yet.</strong> Set <code>INTEGRATIONS_ENCRYPTION_KEY</code> (32+ random characters) in Vercel and redeploy, or set each integration&apos;s environment variables instead. Non-secret settings and on/off switches still work.</Notice>
        </div>
      )}
      <div className="space-y-10">
        {categories.map((category) => (
          <section key={category} aria-labelledby={`cat-${category}`}>
            <h2 id={`cat-${category}`} className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{CATEGORY_LABELS[category]}</h2>
            <div className="grid gap-6 xl:grid-cols-2">
              {INTEGRATIONS.filter((d) => d.category === category).map((def) => (
                <IntegrationCard key={def.key} def={def} state={byKey.get(def.key)!} editable={editable} encryption={encryption} origin={origin}
                  usedBy={def.category === "payments" ? markets.filter((m) => m.paymentProvider === def.key).map((m) => `${m.name}${m.status === "ACTIVE" ? "" : " (paused)"}`) : null} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function statusOf(state: ResolvedIntegration) {
  if (state.storageError) return <StatusBadge status="Needs attention" tone="critical" />;
  if (state.active) return <StatusBadge status="Active" tone="good" />;
  if (state.configured) return <StatusBadge status="Switched off" tone="neutral" />;
  return <StatusBadge status="Not set up" tone="warning" />;
}

function IntegrationCard({ def, state, editable, encryption, origin, usedBy }: { def: IntegrationDef; state: ResolvedIntegration; editable: boolean; encryption: boolean; origin: string | null; usedBy: string[] | null }) {
  const envFields = def.fields.filter((f) => state.sources[f.key] === "env");
  return (
    <Card title={def.name} description={def.summary}
      actions={<span className="flex items-center gap-3">{statusOf(state)}<a href={def.docs} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">Docs <ArrowSquareOut size={12} aria-hidden="true" /></a></span>}>
      <div className="space-y-4">
        {state.storageError && <Notice tone="critical">{state.storageError}</Notice>}
        {usedBy && (
          <p className="text-sm text-slate-600">
            {usedBy.length ? <>Takes payments for: <strong className="font-medium text-slate-800">{usedBy.join(", ")}</strong>.</> : "Not used by any market yet. Choose a gateway per market in Markets & delivery."}
          </p>
        )}
        {def.webhookPath && (
          <Field label="Webhook URL" help={`Register this in your ${def.name} dashboard.`}>
            <input readOnly value={origin ? `${origin}${def.webhookPath}` : `(set APP_BASE_URL)${def.webhookPath}`} className={`${inputClass} font-mono text-xs`} />
          </Field>
        )}
        {state.lastTest.at && (
          <p className="text-xs text-slate-500">
            Last test <DateTime value={state.lastTest.at} />: <span className={state.lastTest.ok ? "text-brand-800" : "text-red-700"}>{state.lastTest.ok ? "passed" : "failed"}</span>
            {state.lastTest.message ? ` · ${state.lastTest.message}` : ""}
          </p>
        )}
        {envFields.length > 0 && (
          <p className="text-xs text-slate-500">Set in Vercel (read-only here): {envFields.map((f) => f.env).join(", ")}.</p>
        )}

        {editable ? (
          <>
            <ActionForm action={saveIntegrationAction} hidden={{ integration: def.key }} submitLabel={`Save ${def.name}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                {def.fields.map((field) => <FieldInput key={field.key} field={field} state={state} encryption={encryption} />)}
              </div>
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={state.enabled} className="mt-1" />
                <span>
                  <span className="block font-medium text-slate-800">Switched on</span>
                  <span className="text-xs text-slate-500">{def.category === "payments" ? "Off stops new payments through this gateway. Payments already taken can still be verified and refunded." : "Off stops the store using this integration."}</span>
                </span>
              </label>
            </ActionForm>
            <div className="border-t border-slate-100 pt-4">
              <ActionForm action={testIntegrationAction} hidden={{ integration: def.key }} submitLabel="Test connection" variant="secondary" inline>
                <p className="text-xs text-slate-500">{TEST_HELP[def.key]}</p>
              </ActionForm>
            </div>
          </>
        ) : (
          <ul className="space-y-1 text-sm">
            {def.fields.map((f) => <li key={f.key} className="flex justify-between gap-4"><span className="text-slate-500">{f.label}</span><span className="text-slate-800">{describeSource(state, f)}</span></li>)}
          </ul>
        )}
      </div>
    </Card>
  );
}

const TEST_HELP: Record<IntegrationDef["key"], string> = {
  paystack: "Makes a read-only call to Paystack with the saved key.",
  whop: "Makes a read-only call to Whop for your company's payments.",
  nvidia: "Sends a one-word prompt to the configured model.",
  resend: "Sends a test email to your own address.",
  storage: "Writes and deletes a tiny file in the bucket.",
};

function describeSource(state: ResolvedIntegration, field: FieldDef) {
  const source = state.sources[field.key];
  if (source === "missing") return "Not set";
  if (source === "env") return field.secret ? `Environment variable (${hint(state.values[field.key])})` : `Environment variable`;
  if (field.secret) return `Saved (${state.hints[field.key] ?? "encrypted"})`;
  return source === "default" ? `Default` : "Saved";
}

function FieldInput({ field, state, encryption }: { field: FieldDef; state: ResolvedIntegration; encryption: boolean }) {
  const source = state.sources[field.key];
  const fromEnv = source === "env";
  const envNote = fromEnv ? `Set by ${field.env} in Vercel.` : undefined;
  const help = [envNote, field.help].filter(Boolean).join(" ");
  const marker = fromEnv ? null : <input type="hidden" name={`present:${field.key}`} value="1" />;

  if (field.type === "boolean") {
    return (
      <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:col-span-2">
        {marker}
        <input type="checkbox" name={field.key} defaultChecked={state.values[field.key] === "true"} disabled={fromEnv} className="mt-1" />
        <span><span className="block font-medium text-slate-800">{field.label}</span>{help && <span className="text-xs text-slate-500">{help}</span>}</span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={field.label} help={help || undefined}>
        {marker}
        <select name={field.key} defaultValue={state.values[field.key] ?? field.default} disabled={fromEnv} className={inputClass}>
          {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
    );
  }
  if (field.secret) {
    // Secret values never leave the server: the input is always empty and write-only.
    const saved = source === "admin" ? state.hints[field.key] : null;
    const placeholder = fromEnv ? `From environment (${hint(state.values[field.key])})` : saved ? `Saved (${saved}). Leave blank to keep.` : field.placeholder ?? "";
    return (
      <Field label={`${field.label}${field.required ? "" : " (optional)"}`} help={help || (!encryption && !fromEnv ? "Needs INTEGRATIONS_ENCRYPTION_KEY before it can be saved here." : undefined)}>
        {marker}
        <input type="password" name={field.key} autoComplete="off" spellCheck={false} disabled={fromEnv || !encryption} placeholder={placeholder} className={`${inputClass} font-mono`} />
        {saved && !fromEnv && (
          <span className="mt-1 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="clear" value={field.key} /> Remove the saved value</span>
        )}
      </Field>
    );
  }
  return (
    <Field label={`${field.label}${field.required ? "" : " (optional)"}`} help={help || undefined}>
      {marker}
      <input name={field.key} defaultValue={fromEnv || source === "admin" ? state.values[field.key] : ""} placeholder={field.default ?? field.placeholder} disabled={fromEnv} className={inputClass} />
    </Field>
  );
}
