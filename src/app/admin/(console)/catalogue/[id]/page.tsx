import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { getAppBaseUrl } from "@/lib/env";
import { getSetting } from "@/lib/settings";
import { getIntegration } from "@/lib/integrations/store";
import { minorToInput } from "@/lib/money";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, Field, MoreOptions, Notice, PageHeader, Select, StatusBadge, inputClass } from "@/app/admin/_components/ui";
import { HOME_MARKET, PriceFields, ProductDetailsForm, SizeMoreOptions, orderMarkets } from "@/app/admin/_components/product-form";
import { addImageAction, addSizeAction, primaryImageAction, removeImageAction, savePriceAction, saveSizeAction, setStockAction } from "@/app/admin/actions/catalogue";

export const metadata = { title: "Product" };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const staff = await requireStaffPage();
  const editable = can(staff.role, "catalogue.manage");
  const stockEditable = can(staff.role, "inventory.manage");
  const locationCode = await getSetting("fulfilment.locationCode");
  const [product, categories, markets, ai, storage] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: { media: { orderBy: { sortOrder: "asc" } }, variants: { orderBy: { createdAt: "asc" }, include: { marketProducts: true, balances: { where: { location: { code: locationCode } } } } } },
    }),
    prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.market.findMany({ where: { status: { in: ["ACTIVE", "PAUSED"] } }, orderBy: { code: "asc" } }),
    getIntegration("nvidia"),
    getIntegration("storage"),
  ]);
  if (!product) notFound();
  let shopOrigin = "";
  try { shopOrigin = getAppBaseUrl(); } catch { /* local development */ }

  const home = markets.find((m) => m.code === HOME_MARKET);
  const sellingSizes = product.variants.filter((v) => v.status === "ACTIVE");
  const pricedAtHome = sellingSizes.some((v) => v.marketProducts.some((mp) => mp.marketId === home?.id && mp.status === "ACTIVE"));
  const live = product.status === "ACTIVE" && home?.status === "ACTIVE" && pricedAtHome;
  const whyHidden = [
    product.status === "DRAFT" && "it is saved as a draft. Change “Show in the shop?” to Yes",
    product.status === "ARCHIVED" && "it is marked as no longer sold",
    sellingSizes.length === 0 && "no size is on sale",
    sellingSizes.length > 0 && !pricedAtHome && `it has no price for ${home?.name ?? "Nigeria"}`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={product.name}
        description={live
          ? <span className="flex flex-wrap items-center gap-2"><StatusBadge status="In the shop" tone="good" />{shopOrigin && <a href={`${shopOrigin}/products/${product.slug}`} target="_blank" rel="noreferrer" className="text-brand-800 underline">See it in the shop ↗</a>}</span>
          : <span className="flex flex-wrap items-center gap-2"><StatusBadge status="Not in the shop" tone="neutral" /><span>Customers can&apos;t see it because {whyHidden.join(", and ") || "it is not ready yet"}.</span></span>}
        actions={<Link href="/admin/catalogue" className="text-sm text-slate-600 hover:underline">← All products</Link>} />

      {query.added === "1" && <div className="mb-6"><Notice tone="good"><strong>Product added.</strong> Everything about it is on this page, and you can change any of it.</Notice></div>}

      <div className="space-y-6">
        <Card title="Details">
          <ProductDetailsForm product={product} categories={categories} aiReady={ai.active} disabled={!editable} shopOrigin={shopOrigin || "your shop"} />
        </Card>

        <Card title="Photos" description={product.media.length ? "The first photo is the one customers see first." : "No photos yet. Until you add one, the shop shows a drawing of a pack."}>
          {product.media.length > 0 && (
            <ul className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {product.media.map((m, i) => (
                <li key={m.id} className="rounded-lg border border-slate-200 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- staff-supplied image URL */}
                  <img src={m.url} alt={m.altText} className="aspect-square w-full rounded-md bg-slate-100 object-cover" loading="lazy" />
                  {i === 0 && <p className="mt-2 text-xs font-medium text-brand-800">Main photo</p>}
                  {editable && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {i > 0 && <ActionForm action={primaryImageAction} hidden={{ imageId: m.id }} submitLabel="Make main photo" variant="secondary" />}
                      <ActionForm action={removeImageAction} hidden={{ imageId: m.id }} submitLabel="Remove" variant="secondary" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && product.media.length < 8 && (
            <ActionForm action={addImageAction} hidden={{ productId: product.id }} submitLabel="Add photo">
              {storage.active && (
                <Field label="Choose a photo" help="JPEG, PNG or WebP, up to 4 MB.">
                  <input name="file" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-800 hover:file:bg-brand-100" />
                </Field>
              )}
              <MoreOptions>
                <Field label="Describe the photo" help="A few words, e.g. Front of the pack. Helps customers using screen readers."><input name="altText" maxLength={200} className={inputClass} /></Field>
                <Field label="Or use a photo that is already online" help="Paste the address of an image that starts with https://"><input name="url" type="url" placeholder="https://" className={inputClass} /></Field>
              </MoreOptions>
            </ActionForm>
          )}
        </Card>

        {product.variants.length === 0 && <Notice tone="warning">This product has no sizes yet. Add one below to give it a price and stock.</Notice>}

        {product.variants.map((v) => {
          const balance = v.balances[0];
          const onHand = balance?.quantityOnHand ?? 0;
          const reserved = balance?.reservedQuantity ?? 0;
          return (
            <Card key={v.id} title={`Size: ${v.packSize}`}
              actions={v.status === "ACTIVE" ? <StatusBadge status="On sale" tone="good" /> : <StatusBadge status="Not on sale" tone="neutral" />}>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4 rounded-lg bg-slate-50 p-4">
                <div>
                  <div className="text-sm text-slate-600">In stock</div>
                  <div className="text-2xl font-semibold tabular-nums text-slate-900">{onHand}</div>
                  {reserved > 0 && <div className="text-xs text-slate-500">{reserved} set aside for customers who are paying or waiting for delivery</div>}
                  {onHand - reserved <= 0 && <div className="text-xs font-medium text-amber-700">Shows as sold out in the shop</div>}
                </div>
                {stockEditable && (
                  <ActionForm action={setStockAction} hidden={{ variantId: v.id }} submitLabel="Update stock" variant="secondary" inline>
                    <Field label="How many do you have now?"><input name="stock" inputMode="numeric" defaultValue={onHand} className={`${inputClass} !w-28`} /></Field>
                  </ActionForm>
                )}
              </div>

              {editable ? (
                <ActionForm action={saveSizeAction} hidden={{ variantId: v.id }} submitLabel="Save size and prices">
                  <Field label="Size" help="How it is sold, e.g. 500 g, 1 litre or Pack of 6.">
                    <input name="packSize" required defaultValue={v.packSize} maxLength={60} className={`${inputClass} sm:max-w-xs`} />
                  </Field>
                  <PriceFields markets={markets} origin={product.originCountry} current={v.marketProducts} />
                  <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                    <input type="checkbox" name="onSale" defaultChecked={v.status === "ACTIVE"} className="mt-0.5" />
                    <span><span className="font-medium text-slate-900">Selling this size</span><span className="block text-slate-500">Untick to stop selling it without losing its details.</span></span>
                  </label>
                  <SizeMoreOptions markets={markets} current={v.marketProducts} variant={v} />
                </ActionForm>
              ) : (
                <p className="text-sm text-slate-600">Product code {v.sku}</p>
              )}

              {editable && markets.length > 0 && (
                <details className="mt-5 border-t border-slate-100 pt-4">
                  <summary className="cursor-pointer text-sm text-slate-600">Advanced rules per country (shelf life, export notes)</summary>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    {orderMarkets(markets).map((m) => {
                      const mp = v.marketProducts.find((x) => x.marketId === m.id);
                      if (!mp) return null;
                      return (
                        <div key={m.id} className="rounded-lg border border-slate-200 p-4">
                          <div className="mb-3 text-sm font-medium">{m.name}</div>
                          <ActionForm action={savePriceAction} hidden={{ variantId: v.id, marketId: m.id, price: minorToInput(mp.priceMinor), compareAt: minorToInput(mp.compareAtMinor) }} submitLabel="Save rules" variant="secondary">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="Minimum shelf life (days)" help="Days left before expiry when shipped."><input name="minShelfLifeDays" inputMode="numeric" defaultValue={mp.minShelfLifeDays ?? ""} className={inputClass} /></Field>
                              <Field label="Sold here?"><Select name="status" options={[["ACTIVE", "Yes"], ["ARCHIVED", "No"]]} defaultValue={mp.status === "ACTIVE" ? "ACTIVE" : "ARCHIVED"} /></Field>
                              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="exportEligible" defaultChecked={mp.exportEligible} /> Allowed to be sent from {product.originCountry === m.countryCode ? "within the country" : "abroad"} to here</label>
                              <Field label="Notes (export or legal restrictions)" className="sm:col-span-2"><input name="restrictionNotes" defaultValue={mp.restrictionNotes ?? ""} className={inputClass} /></Field>
                            </div>
                          </ActionForm>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </Card>
          );
        })}

        {editable && (
          <Card title={product.variants.length ? "Add another size" : "Add a size"} description="For example a bigger pack. Each size has its own price and stock.">
            <ActionForm action={addSizeAction} hidden={{ productId: product.id }} submitLabel="Add size">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Size" help="e.g. 1 kg or Pack of 12."><input name="packSize" required maxLength={60} className={inputClass} /></Field>
                <Field label="Number in stock right now"><input name="stock" inputMode="numeric" defaultValue="0" className={inputClass} /></Field>
              </div>
              <PriceFields markets={markets} origin={product.originCountry} />
              <SizeMoreOptions markets={markets} />
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
