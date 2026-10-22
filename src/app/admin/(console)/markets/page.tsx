import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { minorToInput } from "@/lib/money";
import { COUNTRY_OPTIONS, countryName } from "@/lib/countries";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, Field, Money, MoneyInput, MoreOptions, PageHeader, Select, StatusBadge, inputClass } from "@/app/admin/_components/ui";
import { saveMarketAction, saveShippingRuleAction } from "@/app/admin/actions/config";

export const metadata = { title: "Delivery & countries" };

const CURRENCIES: [string, string][] = [["NGN", "Naira (₦)"], ["USD", "US dollar ($)"], ["GBP", "British pound (£)"], ["EUR", "Euro (€)"], ["CAD", "Canadian dollar (CA$)"]];
const currencyLabel = (c: string) => CURRENCIES.find(([code]) => code === c)?.[1] ?? c;

export default async function DeliveryPage() {
  const staff = await requireStaffPage();
  const editable = can(staff.role, "markets.manage");
  const markets = await prisma.market.findMany({ orderBy: { code: "asc" }, include: { shippingRules: { orderBy: { countryCode: "asc" } }, _count: { select: { marketProducts: { where: { status: "ACTIVE" } } } } } });
  const sorted = [...markets].sort((a, b) => Number(b.code === "NG") - Number(a.code === "NG") || a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Delivery & countries" description="The places you sell to, the currency customers there pay in, and what you charge for delivery. Customers choose one of these at the top of the shop." />
      <div className="space-y-6">
        {sorted.map((m) => {
          const ready = m.status === "ACTIVE" && m.shippingRules.some((r) => r.enabled && r.flatRateMinor !== null);
          return (
            <Card key={m.id} title={m.name}
              description={`Customers pay in ${currencyLabel(m.currency)} · ${m._count.marketProducts} product price${m._count.marketProducts === 1 ? "" : "s"} set`}
              actions={m.status === "ACTIVE" ? (ready ? <StatusBadge status="Taking orders" tone="good" /> : <StatusBadge status="Needs a delivery fee" tone="warning" />) : <StatusBadge status="Paused" tone="neutral" />}>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Delivery fees</h3>
              {m.shippingRules.length === 0 && <p className="mb-3 text-sm text-slate-600">No delivery fee yet, so customers here can&apos;t check out. Add one below.</p>}
              <ul className="space-y-3">
                {m.shippingRules.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span><span className="font-medium">To {countryName(r.countryCode)}</span>: {r.flatRateMinor !== null ? <Money minor={r.flatRateMinor} currency={m.currency} /> : "no fee set"} per order</span>
                      {r.enabled ? <StatusBadge status="Delivering" tone="good" /> : <StatusBadge status="Not delivering" tone="neutral" />}
                    </div>
                    {editable && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm text-brand-800">Change</summary>
                        <ActionForm action={saveShippingRuleAction} hidden={{ marketId: m.id, ruleId: r.id, serviceCode: r.serviceCode ?? "" }} submitLabel="Save" variant="secondary" className="mt-3">
                          <RuleFields rule={r} currency={m.currency} many={m.code === "OTHER"} />
                        </ActionForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              {editable && (
                <details className="mt-4" open={m.shippingRules.length === 0}>
                  <summary className="cursor-pointer text-sm font-medium text-brand-800">{m.code === "OTHER" ? "Add a country you deliver to" : "Add a delivery fee"}</summary>
                  <ActionForm action={saveShippingRuleAction} hidden={{ marketId: m.id }} submitLabel="Add" className="mt-3">
                    <RuleFields currency={m.currency} defaultCountry={m.code === "OTHER" ? "" : m.countryCode} many={m.code === "OTHER"} />
                  </ActionForm>
                </details>
              )}
              {editable && (
                <details className="mt-4 border-t border-slate-100 pt-4">
                  <summary className="cursor-pointer text-sm text-slate-600">Change name, currency or pause</summary>
                  <ActionForm action={saveMarketAction} hidden={{ marketId: m.id, code: m.code, countryCode: m.countryCode }} submitLabel="Save" className="mt-3">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Name customers see"><input name="name" required defaultValue={m.name} className={inputClass} /></Field>
                      <Field label="Customers pay in"><Select name="currency" options={CURRENCIES} defaultValue={m.currency} /></Field>
                      <Field label="Taking orders?"><Select name="status" options={[["ACTIVE", "Yes"], ["PAUSED", "Paused"]]} defaultValue={m.status} /></Field>
                    </div>
                  </ActionForm>
                </details>
              )}
            </Card>
          );
        })}

        {editable && (
          <Card title="Add a place you sell to" description="For example Ghana, or one place for the rest of the world.">
            <ActionForm action={saveMarketAction} submitLabel="Add">
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-3"><input type="radio" name="covers" value="one" defaultChecked className="mt-0.5" /><span><span className="font-medium">One country</span><span className="block text-slate-500">e.g. Ghana in Ghanaian prices</span></span></label>
                <label className="flex items-start gap-3"><input type="radio" name="covers" value="many" className="mt-0.5" /><span><span className="font-medium">Many countries</span><span className="block text-slate-500">e.g. &quot;Rest of the world&quot;. You can only have one of these.</span></span></label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name customers see"><input name="name" required placeholder="e.g. Ghana" className={inputClass} /></Field>
                <Field label="Country" help="For many countries, pick the main one."><Select name="countryCode" options={COUNTRY_OPTIONS} defaultValue="NG" /></Field>
                <Field label="Customers pay in"><Select name="currency" options={CURRENCIES} defaultValue="USD" /></Field>
                <Field label="Taking orders?"><Select name="status" options={[["PAUSED", "Not yet (paused)"], ["ACTIVE", "Yes"]]} defaultValue="PAUSED" /></Field>
              </div>
              <MoreOptions>
                <Field label="Short code" help="Made automatically. Only change it if you know you need to."><input name="code" maxLength={12} pattern="[A-Za-z][A-Za-z0-9]{1,11}" className={`${inputClass} uppercase sm:max-w-[10rem]`} /></Field>
              </MoreOptions>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}

function RuleFields({ rule, currency, defaultCountry, many }: { rule?: { countryCode: string; providerCode: string; enabled: boolean; flatRateMinor: bigint | null; minOrderMinor: bigint | null; maxWeightGrams: number | null }; currency: string; defaultCountry?: string; many: boolean }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {many
          ? <Field label="Country"><Select name="countryCode" options={COUNTRY_OPTIONS} defaultValue={rule?.countryCode ?? defaultCountry ?? ""} /></Field>
          : <input type="hidden" name="countryCode" value={rule?.countryCode ?? defaultCountry ?? ""} />}
        <Field label="Delivery fee per order"><MoneyInput name="flatRate" currency={currency} defaultValue={minorToInput(rule?.flatRateMinor)} required /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} /> Delivering here now</label>
      <MoreOptions>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Courier name" help="For your own records, e.g. GIG."><input name="providerCode" defaultValue={rule?.providerCode === "Standard" ? "" : rule?.providerCode} className={inputClass} /></Field>
          <Field label="Only for orders over"><MoneyInput name="minOrder" currency={currency} defaultValue={minorToInput(rule?.minOrderMinor)} placeholder="" /></Field>
          <Field label="Heaviest parcel (grams)"><input name="maxWeightGrams" inputMode="numeric" defaultValue={rule?.maxWeightGrams ?? ""} className={inputClass} /></Field>
        </div>
      </MoreOptions>
    </div>
  );
}
