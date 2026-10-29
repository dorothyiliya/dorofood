import type { Category, Product } from "@prisma/client";
import { ActionForm } from "@/app/admin/_components/action-form";
import { AiDraftButton } from "@/app/admin/_components/ai-draft-button";
import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { Field, MoneyInput, MoreOptions, Step, inputClass } from "@/app/admin/_components/ui";
import { createProductAction, updateProductAction } from "@/app/admin/actions/catalogue";
import { COUNTRY_OPTIONS, countryName } from "@/lib/countries";
import { minorToInput } from "@/lib/money";

export type PriceMarket = { id: string; code: string; name: string; currency: string; countryCode: string; status: string };
export type CurrentPrice = { marketId: string; priceMinor: bigint; compareAtMinor: bigint | null; status: string };

export const HOME_MARKET = "NG";

/** Home market first, then the others by name. */
export function orderMarkets<T extends { code: string; name: string }>(markets: T[]) {
  return [...markets].sort((a, b) => Number(b.code === HOME_MARKET) - Number(a.code === HOME_MARKET) || a.name.localeCompare(b.name));
}

function priceHint(m: PriceMarket, origin: string) {
  if (m.code === HOME_MARKET) return "Required. This is the main price customers see.";
  if (m.countryCode === origin) return `Optional. For customers in ${countryName(m.countryCode)} who pay in ${m.currency}.`;
  return "Optional. Leave empty if this product can't be sent abroad.";
}

/** One price box per country the shop sells to. An empty box means "not sold there". */
export function PriceFields({ markets, origin = "NG", current = [] }: { markets: PriceMarket[]; origin?: string; current?: CurrentPrice[] }) {
  if (markets.length === 0) {
    return <p className="text-sm text-amber-800">Add where you deliver first (Delivery &amp; countries), then come back to set prices.</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {orderMarkets(markets).map((m) => {
        const now = current.find((c) => c.marketId === m.id && c.status === "ACTIVE");
        return (
          <Field key={m.id} label={`Price for ${m.name}${m.status === "ACTIVE" ? "" : " (not open yet)"}`} help={priceHint(m, origin)}>
            <MoneyInput name={`price:${m.id}`} currency={m.currency} required={m.code === HOME_MARKET} defaultValue={now ? minorToInput(now.priceMinor) : undefined} />
          </Field>
        );
      })}
    </div>
  );
}

/** Size-level options most people never need. */
export function SizeMoreOptions({ markets, current = [], variant }: { markets: PriceMarket[]; current?: CurrentPrice[]; variant?: { sku: string; barcode: string | null; weightGrams: number | null } }) {
  const home = markets.find((m) => m.code === HOME_MARKET);
  const homeNow = home ? current.find((c) => c.marketId === home.id) : undefined;
  return (
    <MoreOptions>
      <div className="grid gap-4 sm:grid-cols-2">
        {home && (
          <Field label={`Old price in ${home.name}`} help="Shows the product as on sale, with this price crossed out. Must be higher than the price above.">
            <MoneyInput name={`was:${home.id}`} currency={home.currency} defaultValue={homeNow?.compareAtMinor ? minorToInput(homeNow.compareAtMinor) : undefined} placeholder="" />
          </Field>
        )}
        <Field label="Weight in grams" help="Only needed if a courier limits parcel weight.">
          <input name="weightGrams" inputMode="numeric" defaultValue={variant?.weightGrams ?? ""} placeholder="e.g. 500" className={inputClass} />
        </Field>
        <Field label="Barcode" help="The number under the barcode on the pack, if it has one.">
          <input name="barcode" defaultValue={variant?.barcode ?? ""} className={inputClass} />
        </Field>
        <Field label="Product code" help={variant ? "Your internal code for this size." : "Leave empty and we'll make one for you."}>
          <input name="sku" defaultValue={variant?.sku ?? ""} placeholder={variant ? "" : "Made automatically"} className={`${inputClass} uppercase`} />
        </Field>
      </div>
    </MoreOptions>
  );
}

function CategorySelect({ categories, value }: { categories: Category[]; value?: string | null }) {
  return (
    <Field label="Category" help={<>Where it appears in the shop, e.g. Snacks or Drinks. <Link href="/admin/categories" className="underline">Add or edit categories</Link></>}>
      <select name="categoryId" defaultValue={value ?? ""} className={inputClass}>
        <option value="">No category</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== "ACTIVE" ? " (hidden)" : ""}</option>)}
      </select>
    </Field>
  );
}

function CountrySelect({ name, value }: { name: string; value: string }) {
  return (
    <select name={name} defaultValue={value} className={inputClass}>
      {COUNTRY_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
    </select>
  );
}

/** The one-page "Add a product" form. */
export function NewProductForm({ categories, markets, aiReady, uploads }: { categories: Category[]; markets: PriceMarket[]; aiReady: boolean; uploads: boolean }) {
  return (
    <ActionForm action={createProductAction} submitLabel="Add product" className="space-y-5">
      <Step n={1} title="What are you selling?">
        <Field label="Product name" help="As customers should see it, e.g. Plantain Chips.">
          <input name="name" required minLength={2} maxLength={120} placeholder="e.g. Plantain Chips" className={inputClass} />
        </Field>
        <div>
          <Field label="Description" help={aiReady ? "A few sentences about taste, ingredients and how to use it. Or type a few notes and press Write it for me." : "A few sentences about taste, ingredients and how to use it."}>
            <textarea name="description" required minLength={10} rows={4} className={inputClass} placeholder="e.g. Thin, crunchy plantain chips, lightly salted. Great with a cold drink." />
          </Field>
          {aiReady && <AiDraftButton />}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <CategorySelect categories={categories} />
          <Field label="Brand (optional)"><input name="brand" maxLength={80} className={inputClass} /></Field>
        </div>
      </Step>

      <Step n={2} title="Add a photo" hint="A clear photo on a plain background sells best. You can add more photos later.">
        {uploads
          ? <Field label="Choose a photo" help="JPEG, PNG or WebP, up to 4 MB."><input name="file" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-800 hover:file:bg-brand-100" /></Field>
          : <p className="text-sm text-slate-500">Photo uploads aren&apos;t switched on yet. You can add a photo later from the product page.</p>}
      </Step>

      <Step n={3} title="Size and price" hint="If it comes in more than one size, add the other sizes after saving.">
        <Field label="Size" help="How it is sold, e.g. 500 g, 1 litre or Pack of 6.">
          <input name="packSize" required maxLength={60} placeholder="e.g. 500 g" className={`${inputClass} sm:max-w-xs`} />
        </Field>
        <PriceFields markets={markets} />
        <SizeMoreOptions markets={markets} />
      </Step>

      <Step n={4} title="How many do you have?">
        <Field label="Number in stock right now" help="When this reaches 0 the shop shows it as sold out. You can change it any time.">
          <input name="stock" inputMode="numeric" defaultValue="0" className={`${inputClass} sm:max-w-[10rem]`} />
        </Field>
      </Step>

      <Step n={5} title="Show it in the shop?">
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3"><input type="radio" name="show" value="yes" defaultChecked className="mt-0.5" /><span><span className="font-medium text-slate-900">Yes, show it now</span><span className="block text-slate-500">Customers can see and buy it straight away.</span></span></label>
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3"><input type="radio" name="show" value="no" className="mt-0.5" /><span><span className="font-medium text-slate-900">Not yet</span><span className="block text-slate-500">Save it as a draft and show it later.</span></span></label>
        </div>
        <MoreOptions label="Where it's made">
          <Field label="Made in" help="Used to check which products can be sent abroad."><CountrySelect name="originCountry" value="NG" /></Field>
        </MoreOptions>
      </Step>
    </ActionForm>
  );
}

const SHOW_OPTIONS: [string, string][] = [["ACTIVE", "Yes, show it in the shop"], ["DRAFT", "No, keep it hidden (draft)"], ["ARCHIVED", "No, we don't sell it any more"]];

/** Product details on the product page. */
export function ProductDetailsForm({ product, categories, aiReady, disabled, shopOrigin }: { product: Product; categories: Category[]; aiReady: boolean; disabled?: boolean; shopOrigin: string }) {
  const fields = (
    <fieldset disabled={disabled} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name"><input name="name" required defaultValue={product.name} className={inputClass} /></Field>
        <Field label="Show in the shop?">
          <select name="status" defaultValue={product.status} className={inputClass}>
            {SHOW_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>
      <div>
        <Field label="Description"><textarea name="description" required minLength={10} rows={5} defaultValue={product.description} className={inputClass} /></Field>
        {aiReady && !disabled && <AiDraftButton />}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CategorySelect categories={categories} value={product.categoryId} />
        <Field label="Brand (optional)"><input name="brand" defaultValue={product.brand ?? ""} className={inputClass} /></Field>
      </div>
      <MoreOptions>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Made in" help="Used to check which products can be sent abroad."><CountrySelect name="originCountry" value={product.originCountry} /></Field>
          <Field label="Web address" help={`${shopOrigin}/products/${product.slug}. Leave as it is unless you have a reason to change it.`}>
            <input name="slug" defaultValue={product.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Lowercase letters, numbers and single dashes" className={inputClass} />
          </Field>
        </div>
      </MoreOptions>
      <MoreOptions label="How it looks on Google">
        <Field label="Google title" help={`Leave empty to use the product name. Best under 60 characters. Your shop name is added automatically.`}>
          <input name="seoTitle" defaultValue={product.seoTitle ?? ""} maxLength={120} placeholder={product.name} className={inputClass} />
        </Field>
        <Field label="Google description" help="One or two sentences shown under the title on Google (about 120 to 160 characters). Leave empty to use the start of the description.">
          <textarea name="seoDescription" defaultValue={product.seoDescription ?? ""} maxLength={320} rows={2} className={inputClass} />
        </Field>
      </MoreOptions>
    </fieldset>
  );
  if (disabled) return fields;
  return <ActionForm action={updateProductAction} hidden={{ productId: product.id }} submitLabel="Save details">{fields}</ActionForm>;
}
