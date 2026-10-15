import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { getSettings } from "@/lib/settings";
import { ADJUSTMENT_REASONS } from "@/lib/admin/stock";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, DateTime, Field, PageHeader, Select, StatusBadge, Table, Tabs, humanise, inputClass, td } from "@/app/admin/_components/ui";
import { changeStockAction, saveLocationAction } from "@/app/admin/actions/config";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const staff = await requireStaffPage();
  const editable = can(staff.role, "inventory.manage");
  const settings = await getSettings();
  const locations = await prisma.inventoryLocation.findMany({ orderBy: { code: "asc" } });
  const location = locations.find((l) => l.id === params.location) ?? locations.find((l) => l.code === settings["fulfilment.locationCode"]) ?? locations[0];
  const tab = params.tab === "movements" ? "movements" : params.tab === "locations" ? "locations" : "stock";
  const focusVariant = typeof params.variant === "string" ? params.variant : undefined;

  const variants = await prisma.productVariant.findMany({
    where: { status: { not: "ARCHIVED" } }, orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    include: { product: { select: { id: true, name: true } }, balances: location ? { where: { locationId: location.id } } : false },
  });

  return (
    <>
      <PageHeader title="Inventory" description={<>Physical stock by location. <strong>Reserved</strong> units are held for customers who are paying or have paid; they leave stock when the order is dispatched.</>} />
      {locations.length > 1 && (
        <form className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-slate-600">Location</span>
          <select name="location" defaultValue={location?.id} className={`${inputClass} sm:!w-64`}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}{l.code === settings["fulfilment.locationCode"] ? " (fulfilment)" : ""}</option>)}
          </select>
          <button className="rounded-md bg-slate-800 px-3 py-1.5 font-medium text-white">Show</button>
        </form>
      )}
      <Tabs active={tab} tabs={[
        { key: "stock", label: "Stock levels", href: `/admin/inventory${location ? `?location=${location.id}` : ""}` },
        { key: "movements", label: "Movement history", href: `/admin/inventory?tab=movements${location ? `&location=${location.id}` : ""}` },
        { key: "locations", label: "Locations", href: "/admin/inventory?tab=locations" },
      ]} />

      {tab === "stock" && (
        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <Card title={location ? `${location.code} · ${location.name}` : "No location"} description={location ? undefined : "Create a location in the Locations tab first."}>
            <Table head={["Product", "SKU", "On hand", "Reserved", "Sellable", ""]} empty="No variants yet.">
              {variants.map((v) => {
                const b = Array.isArray(v.balances) ? v.balances[0] : undefined;
                const sellable = (b?.quantityOnHand ?? 0) - (b?.reservedQuantity ?? 0);
                return (
                  <tr key={v.id} className={v.id === focusVariant ? "bg-brand-50" : undefined}>
                    <td className={td}><Link href={`/admin/catalogue/${v.product.id}`} className="hover:underline">{v.product.name}</Link> <span className="text-xs text-slate-500">{v.packSize}</span></td>
                    <td className={`${td} font-mono text-xs`}>{v.sku}</td>
                    <td className={`${td} tabular-nums`}>{b?.quantityOnHand ?? 0}</td>
                    <td className={`${td} tabular-nums`}>{b?.reservedQuantity ?? 0}</td>
                    <td className={`${td} tabular-nums`}>{sellable}</td>
                    <td className={td}>{sellable <= 0 ? <StatusBadge status="Out of stock" tone="critical" /> : sellable <= settings["inventory.lowStockThreshold"] ? <StatusBadge status="Low" tone="warning" /> : null}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>
          {editable && location && (
            <Card title="Change stock" description="Receive deliveries, record damage, or enter a stocktake count. Every change is logged.">
              <ActionForm action={changeStockAction} hidden={{ locationId: location.id }} submitLabel="Apply">
                <Field label="Variant">
                  <select name="variantId" required defaultValue={focusVariant} className={inputClass}>
                    {variants.map((v) => <option key={v.id} value={v.id}>{v.product.name} · {v.sku}</option>)}
                  </select>
                </Field>
                <Field label="Type of change"><Select name="mode" options={[["delta", "Add or remove units"], ["count", "Stocktake: set the counted total"]]} /></Field>
                <Field label="Quantity" help="For add/remove, use a negative number to remove (e.g. -2)."><input name="quantity" required inputMode="numeric" className={inputClass} /></Field>
                <Field label="Reason" help="Stocktakes are always recorded as STOCKTAKE."><Select name="reason" options={ADJUSTMENT_REASONS.filter((r) => r !== "STOCKTAKE")} /></Field>
                <Field label="Note"><input name="note" placeholder="Supplier invoice, batch, reason…" className={inputClass} /></Field>
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      {tab === "movements" && location && <Movements locationId={location.id} />}

      {tab === "locations" && (
        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <Card title="Locations" description={`Orders reserve stock from the fulfilment location (${settings["fulfilment.locationCode"]}), set in Store settings.`}>
            <div className="divide-y divide-slate-100">
              {locations.map((l) => (
                <div key={l.id} className="py-3">
                  <div className="mb-2 text-sm font-medium">{l.code} · {l.name} <StatusBadge status={l.active ? "ACTIVE" : "PAUSED"} /></div>
                  {editable && <ActionForm action={saveLocationAction} hidden={{ locationId: l.id }} submitLabel="Save" variant="secondary" inline><LocationFields location={l} /></ActionForm>}
                </div>
              ))}
            </div>
          </Card>
          {editable && <Card title="New location"><ActionForm action={saveLocationAction} submitLabel="Create location"><LocationFields /></ActionForm></Card>}
        </div>
      )}
    </>
  );
}

async function Movements({ locationId }: { locationId: string }) {
  const movements = await prisma.inventoryMovement.findMany({ where: { locationId }, orderBy: { createdAt: "desc" }, take: 200, include: { variant: { select: { sku: true, product: { select: { name: true } } } } } });
  const actors = new Map((await prisma.staffUser.findMany({ where: { id: { in: [...new Set(movements.map((m) => m.actorId).filter((a): a is string => !!a))] } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  return (
    <Card title="Last 200 movements">
      <Table head={["When", "Product", "Change", "Reason", "Reference", "Note", "By"]} empty="No stock movements yet.">
        {movements.map((m) => (
          <tr key={m.id}>
            <td className={td}><DateTime value={m.createdAt} /></td>
            <td className={td}>{m.variant.product.name} <span className="font-mono text-xs text-slate-500">{m.variant.sku}</span></td>
            <td className={`${td} tabular-nums font-medium ${m.quantityDelta < 0 ? "text-red-700" : "text-brand-800"}`}>{m.quantityDelta > 0 ? "+" : ""}{m.quantityDelta}</td>
            <td className={td}>{humanise(m.reason)}</td>
            <td className={`${td} text-xs`}>{m.reference ?? ""}</td>
            <td className={`${td} max-w-xs text-xs`}>{m.note ?? ""}</td>
            <td className={`${td} text-xs`}>{m.actorId ? actors.get(m.actorId) ?? m.actorId : "system"}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function LocationFields({ location }: { location?: { code: string; name: string; active: boolean; addressJson: unknown } }) {
  const address = (location?.addressJson as { text?: string; note?: string } | undefined);
  return (
    <>
      <Field label="Code"><input name="code" required defaultValue={location?.code} className={`${inputClass} uppercase`} /></Field>
      <Field label="Name"><input name="name" required defaultValue={location?.name} className={inputClass} /></Field>
      <Field label="Address"><input name="address" defaultValue={address?.text ?? address?.note ?? ""} className={inputClass} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={location?.active ?? true} /> Active</label>
    </>
  );
}
