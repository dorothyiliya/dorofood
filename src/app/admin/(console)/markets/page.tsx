import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { minorToInput } from "@/lib/money";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, Field, Money, Notice, PageHeader, Select, StatusBadge, inputClass } from "@/app/admin/_components/ui";
import { saveMarketAction, saveShippingRuleAction } from "@/app/admin/actions/config";
import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { DEFAULT_PAYMENT_PROVIDER, PAYMENT_PROVIDERS, definition, providerName } from "@/lib/integrations/definitions";
import { gatewayReady } from "@/lib/payments/gateway";

export const metadata = { title: "Markets & delivery" };
const CURRENCIES = ["NGN", "GBP", "USD", "CAD", "EUR"];

export default async function MarketsPage() {
  const staff = await requireStaffPage();
  const editable = can(staff.role, "markets.manage");
  const markets = await prisma.market.findMany({ orderBy: { code: "asc" }, include: { shippingRules: { orderBy: { countryCode: "asc" } }, _count: { select: { marketProducts: true } } } });
  const ready = Object.fromEntries(await Promise.all(PAYMENT_PROVIDERS.map(async (p) => [p, await gatewayReady(p)] as const))) as Record<string, boolean>;
  const providerOptions: [string, string][] = PAYMENT_PROVIDERS.map((p) => [p, `${definition(p).name}${ready[p] ? "" : " (not set up)"}`]);
  // New markets start on a gateway that can take payments now.
  const defaultProvider = ready[DEFAULT_PAYMENT_PROVIDER] ? DEFAULT_PAYMENT_PROVIDER : PAYMENT_PROVIDERS.find((p) => ready[p]) ?? DEFAULT_PAYMENT_PROVIDER;

  return (
    <>
      <PageHeader title="Markets & delivery" description="Where you sell, in which currency, and what delivery costs. A destination can only check out when its market is active and it has an enabled delivery rule with a rate." />
      <div className="mb-6"><Notice>Delivery rates here are flat fees you set. No courier integration is connected, so nothing is quoted live and nothing is invented: a destination without a rate cannot check out.</Notice></div>
      <div className="space-y-6">
        {markets.map((m) => (
          <Card key={m.id} title={`${m.name} (${m.code})`} description={`${m.currency} · ${m._count.marketProducts} priced variant(s) · payments by ${providerName(m.paymentProvider)}`} actions={<StatusBadge status={m.status} />}>
            {m.status === "ACTIVE" && !ready[m.paymentProvider] && (
              <div className="mb-4"><Notice tone="warning">Customers can&apos;t pay in this market: {providerName(m.paymentProvider)} is not set up and switched on. <Link href="/admin/integrations" className="font-medium underline">Open Integrations</Link></Notice></div>
            )}
            {editable && (
              <details className="mb-4">
                <summary className="cursor-pointer text-sm font-medium text-brand-800">Edit market</summary>
                <ActionForm action={saveMarketAction} hidden={{ marketId: m.id }} submitLabel="Save market" className="mt-3" inline><MarketFields market={m} providers={providerOptions} defaultProvider={defaultProvider} /></ActionForm>
              </details>
            )}
            <h3 className="mb-2 text-sm font-semibold">Delivery rules</h3>
            {m.shippingRules.length === 0 && <p className="mb-3 text-sm text-slate-500">No delivery rules: this market cannot check out.</p>}
            <div className="space-y-3">
              {m.shippingRules.map((r) => (
                <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">To {r.countryCode}</span>
                    <StatusBadge status={r.enabled ? "ACTIVE" : "PAUSED"} />
                    <span className="text-slate-600">{r.flatRateMinor !== null ? <Money minor={r.flatRateMinor} currency={m.currency} /> : "no rate"} · {r.providerCode}</span>
                  </div>
                  {editable && <ActionForm action={saveShippingRuleAction} hidden={{ marketId: m.id, ruleId: r.id }} submitLabel="Save rule" variant="secondary" inline><RuleFields rule={r} currency={m.currency} /></ActionForm>}
                </div>
              ))}
            </div>
            {editable && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-brand-800">Add delivery rule</summary>
                <ActionForm action={saveShippingRuleAction} hidden={{ marketId: m.id }} submitLabel="Add rule" className="mt-3" inline><RuleFields currency={m.currency} defaultCountry={m.code === "OTHER" ? "" : m.countryCode} /></ActionForm>
              </details>
            )}
          </Card>
        ))}
        {editable && (
          <Card title="New market" description="Use the country's two-letter code (e.g. GH), or OTHER for a multi-country market.">
            <ActionForm action={saveMarketAction} submitLabel="Create market" inline><MarketFields providers={providerOptions} defaultProvider={defaultProvider} /></ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

function MarketFields({ market, providers, defaultProvider }: { market?: { code: string; name: string; countryCode: string; currency: string; status: string; paymentProvider: string }; providers: [string, string][]; defaultProvider: string }) {
  return (
    <>
      <Field label="Code"><input name="code" required defaultValue={market?.code} className={`${inputClass} sm:!w-24 uppercase`} /></Field>
      <Field label="Name"><input name="name" required defaultValue={market?.name} className={inputClass} /></Field>
      <Field label="Country"><input name="countryCode" required maxLength={2} defaultValue={market?.countryCode} className={`${inputClass} sm:!w-20 uppercase`} /></Field>
      <Field label="Currency"><Select name="currency" options={CURRENCIES.map((c) => [c, c])} defaultValue={market?.currency ?? "NGN"} /></Field>
      <Field label="Status"><Select name="status" options={["ACTIVE", "PAUSED"]} defaultValue={market?.status ?? "PAUSED"} /></Field>
      <Field label="Payment gateway" help="Whop takes naira and international cards; Paystack is naira-focused."><Select name="paymentProvider" options={providers} defaultValue={market?.paymentProvider ?? defaultProvider} /></Field>
    </>
  );
}

function RuleFields({ rule, currency, defaultCountry }: { rule?: { countryCode: string; providerCode: string; serviceCode: string | null; enabled: boolean; flatRateMinor: bigint | null; minOrderMinor: bigint | null; maxWeightGrams: number | null }; currency: string; defaultCountry?: string }) {
  return (
    <>
      <Field label="Country"><input name="countryCode" required maxLength={2} defaultValue={rule?.countryCode ?? defaultCountry} className={`${inputClass} sm:!w-20 uppercase`} /></Field>
      <Field label="Courier / provider"><input name="providerCode" required defaultValue={rule?.providerCode} placeholder="GIG" className={`${inputClass} sm:!w-32`} /></Field>
      <Field label="Service"><input name="serviceCode" defaultValue={rule?.serviceCode ?? ""} placeholder="standard" className={`${inputClass} sm:!w-28`} /></Field>
      <Field label={`Flat rate (${currency})`}><input name="flatRate" inputMode="decimal" defaultValue={minorToInput(rule?.flatRateMinor)} className={`${inputClass} sm:!w-28`} /></Field>
      <Field label={`Min. order (${currency})`}><input name="minOrder" inputMode="decimal" defaultValue={minorToInput(rule?.minOrderMinor)} className={`${inputClass} sm:!w-28`} /></Field>
      <Field label="Max weight (g)"><input name="maxWeightGrams" inputMode="numeric" defaultValue={rule?.maxWeightGrams ?? ""} className={`${inputClass} sm:!w-28`} /></Field>
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? false} /> Enabled</label>
    </>
  );
}
