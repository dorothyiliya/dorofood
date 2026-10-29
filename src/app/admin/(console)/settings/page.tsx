import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { SETTINGS, SHOP_SETTING_KEYS, getSettings } from "@/lib/settings";
import { systemStatus } from "@/lib/admin/system";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, Field, Notice, PageHeader, inputClass } from "@/app/admin/_components/ui";
import { saveSettingsAction } from "@/app/admin/actions/config";

export const metadata = { title: "Shop settings" };

export default async function SettingsPage() {
  const staff = await requireStaffPage();
  const editable = can(staff.role, "settings.manage");
  const [settings, status, locations] = await Promise.all([getSettings(), systemStatus(), prisma.inventoryLocation.findMany({ where: { active: true }, orderBy: { code: "asc" } })]);

  const fields = (
    <fieldset disabled={!editable} className="grid gap-5 md:grid-cols-2">
      {SHOP_SETTING_KEYS.map((key) => {
        const def = SETTINGS[key];
        const value = settings[key];
        return (
          <div key={key}>
            <input type="hidden" name={`present:${key}`} value="1" />
            {typeof def.default === "boolean" ? (
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="checkbox" name={key} defaultChecked={value as boolean} className="mt-1" />
                <span><span className="block font-medium text-slate-800">{def.label}</span><span className="text-xs text-slate-500">{def.help}</span></span>
              </label>
            ) : key === "fulfilment.locationCode" ? (
              <Field label={def.label} help={def.help}>
                <select name={key} defaultValue={value as string} className={inputClass}>
                  {!locations.some((l) => l.code === value) && <option value={value as string}>{value as string} (missing)</option>}
                  {locations.map((l) => <option key={l.id} value={l.code}>{l.code} · {l.name}</option>)}
                </select>
              </Field>
            ) : (
              <Field label={def.label} help={def.help}>
                <input name={key} defaultValue={String(value)} inputMode={typeof def.default === "number" ? "numeric" : undefined} className={inputClass} />
              </Field>
            )}
          </div>
        );
      })}
    </fieldset>
  );

  return (
    <>
      <PageHeader title="Shop settings" description="Open or close the shop, the message bar, contact email and other shop-wide options. Changes show in the shop straight away." />
      <div className="mb-6">
        {status.checkout.live
          ? <Notice tone="good">Checkout is live: customers can place orders and pay.</Notice>
          : <Notice tone="warning"><strong>Checkout is not live.</strong> {status.checkout.reasons.join(" ")}</Notice>}
      </div>
      <Card>
        {editable
          ? <ActionForm action={saveSettingsAction} submitLabel="Save settings">{fields}</ActionForm>
          : fields}
        {!editable && <p className="mt-3 text-sm text-slate-500">Your role can view settings but not change them.</p>}
      </Card>
    </>
  );
}
