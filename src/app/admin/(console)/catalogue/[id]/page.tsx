import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { minorToInput } from "@/lib/money";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, Field, Notice, PageHeader, Select, StatusBadge, inputClass } from "@/app/admin/_components/ui";
import { ProductForm } from "@/app/admin/_components/product-form";
import { addImageAction, primaryImageAction, removeImageAction, savePriceAction, saveVariantAction } from "@/app/admin/actions/catalogue";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireStaffPage();
  const editable = can(staff.role, "catalogue.manage");
  const [product, categories, markets] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: { media: { orderBy: { sortOrder: "asc" } }, variants: { orderBy: { createdAt: "asc" }, include: { marketProducts: true, balances: { include: { location: true } } } } },
    }),
    prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.market.findMany({ orderBy: { code: "asc" } }),
  ]);
  if (!product) notFound();
  const live = product.status === "ACTIVE" && product.variants.some((v) => v.status === "ACTIVE" && v.marketProducts.some((mp) => mp.status === "ACTIVE"));

  return (
    <>
      <PageHeader title={product.name} description={<span className="flex items-center gap-2"><StatusBadge status={product.status} /> {live ? "Visible in the shop" : "Not visible in the shop"}</span>}
        actions={<Link href="/admin/catalogue" className="text-sm text-slate-600 hover:underline">← Catalogue</Link>} />
      <div className="space-y-6">
        <Card title="Product details"><ProductForm product={product} categories={categories} disabled={!editable} /></Card>

        <Card title="Photos" description="The first photo is the main one in the shop. Until a photo is added, the shop shows an illustrated pack.">
          {product.media.length === 0 && <p className="mb-4 text-sm text-slate-500">No photos yet.</p>}
          <ul className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {product.media.map((m, i) => (
              <li key={m.id} className="rounded-lg border border-slate-200 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- staff-supplied image URL */}
                <img src={m.url} alt={m.altText} className="aspect-square w-full rounded-md bg-slate-100 object-cover" loading="lazy" />
                <p className="mt-2 line-clamp-2 text-xs text-slate-600">{i === 0 ? <strong className="text-brand-800">Main · </strong> : null}{m.altText}</p>
                {editable && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {i > 0 && <ActionForm action={primaryImageAction} hidden={{ imageId: m.id }} submitLabel="Make main" variant="secondary" />}
                    <ActionForm action={removeImageAction} hidden={{ imageId: m.id }} submitLabel="Remove" variant="secondary" />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {editable && product.media.length < 8 && (
            <ActionForm action={addImageAction} hidden={{ productId: product.id }} submitLabel="Add photo" inline>
              <Field label="Image address (https)" className="min-w-[280px] flex-1"><input name="url" type="url" required placeholder="https://" className={inputClass} /></Field>
              <Field label="Describe the photo" className="min-w-[220px] flex-1"><input name="altText" required minLength={3} placeholder="Pack of Suya Spice Blend, front" className={inputClass} /></Field>
            </ActionForm>
          )}
        </Card>

        {product.variants.length === 0 && <Notice tone="warning">Add at least one variant (a SKU with a pack size) before this product can be priced or sold.</Notice>}

        {product.variants.map((v) => (
          <Card key={v.id} title={`Variant ${v.sku}`} description={`${v.packSize}${v.weightGrams ? ` · ${v.weightGrams} g` : " · weight not set"}`}
            actions={<span className="flex items-center gap-2 text-sm"><StatusBadge status={v.status} /> <Link className="text-brand-800 hover:underline" href={`/admin/inventory?variant=${v.id}`}>Stock: {v.balances.map((b) => `${b.location.code} ${b.quantityOnHand} on hand / ${b.reservedQuantity} reserved`).join(", ") || "none"}</Link></span>}>
            {editable && (
              <details className="mb-5">
                <summary className="cursor-pointer text-sm font-medium text-brand-800">Edit variant</summary>
                <ActionForm action={saveVariantAction} hidden={{ productId: product.id, variantId: v.id }} submitLabel="Save variant" className="mt-3">
                  <VariantFields variant={v} />
                </ActionForm>
              </details>
            )}
            <h3 className="mb-2 text-sm font-semibold">Prices by market</h3>
            {markets.length === 0 && <p className="text-sm text-slate-500">Create a market first (Markets & delivery).</p>}
            <div className="grid gap-4 lg:grid-cols-2">
              {markets.map((m) => {
                const mp = v.marketProducts.find((x) => x.marketId === m.id);
                return (
                  <div key={m.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span className="font-medium">{m.name} <span className="text-slate-500">({m.code}, {m.currency})</span></span>
                      {mp ? <StatusBadge status={mp.status} /> : <span className="text-xs text-slate-500">Not priced</span>}
                    </div>
                    <ActionForm action={savePriceAction} hidden={{ variantId: v.id, marketId: m.id }} submitLabel={mp ? "Save price" : "Add price"} variant="secondary">
                      <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
                        <Field label={`Price (${m.currency})`}><input name="price" required inputMode="decimal" defaultValue={minorToInput(mp?.priceMinor)} className={inputClass} /></Field>
                        <Field label="Compare-at (optional)"><input name="compareAt" inputMode="decimal" defaultValue={minorToInput(mp?.compareAtMinor)} className={inputClass} /></Field>
                        <Field label="Status"><Select name="status" options={["DRAFT", "ACTIVE", "ARCHIVED"]} defaultValue={mp?.status ?? "DRAFT"} /></Field>
                        <Field label="Min. shelf life (days)"><input name="minShelfLifeDays" inputMode="numeric" defaultValue={mp?.minShelfLifeDays ?? ""} className={inputClass} /></Field>
                        <label className="flex items-center gap-2 text-sm sm:col-span-2">
                          <input type="checkbox" name="exportEligible" defaultChecked={mp?.exportEligible ?? false} />
                          Export eligible: may ship from {product.originCountry} to this market
                        </label>
                        <Field label="Restriction notes" className="sm:col-span-2"><input name="restrictionNotes" defaultValue={mp?.restrictionNotes ?? ""} className={inputClass} /></Field>
                      </fieldset>
                    </ActionForm>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}

        {editable && (
          <Card title="Add a variant" description="A variant is one sellable SKU, e.g. the 150 g pack. It starts with zero stock.">
            <ActionForm action={saveVariantAction} hidden={{ productId: product.id }} submitLabel="Add variant"><VariantFields /></ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

function VariantFields({ variant }: { variant?: { sku: string; packSize: string; name: string | null; barcode: string | null; weightGrams: number | null; status: string } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="SKU"><input name="sku" required defaultValue={variant?.sku} className={`${inputClass} uppercase`} /></Field>
      <Field label="Pack size"><input name="packSize" required defaultValue={variant?.packSize} placeholder="150 g" className={inputClass} /></Field>
      <Field label="Weight (grams)" help="Needed for delivery weight limits."><input name="weightGrams" inputMode="numeric" defaultValue={variant?.weightGrams ?? ""} className={inputClass} /></Field>
      <Field label="Variant name (optional)"><input name="variantName" defaultValue={variant?.name ?? ""} className={inputClass} /></Field>
      <Field label="Barcode (optional)"><input name="barcode" defaultValue={variant?.barcode ?? ""} className={inputClass} /></Field>
      <Field label="Status"><Select name="status" options={["DRAFT", "ACTIVE", "ARCHIVED"]} defaultValue={variant?.status ?? "ACTIVE"} /></Field>
    </div>
  );
}
