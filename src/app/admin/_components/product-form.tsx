import type { Category, Product } from "@prisma/client";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Field, Select, inputClass } from "@/app/admin/_components/ui";
import { createProductAction, updateProductAction } from "@/app/admin/actions/catalogue";

export function ProductForm({ product, categories, disabled }: { product?: Product; categories: Category[]; disabled?: boolean }) {
  const fields = (
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
      <Field label="Name"><input name="name" required defaultValue={product?.name} className={inputClass} /></Field>
      <Field label="URL slug" help="Lowercase words joined by hyphens, e.g. suya-spice."><input name="slug" required defaultValue={product?.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" className={inputClass} /></Field>
      <Field label="Brand"><input name="brand" defaultValue={product?.brand ?? ""} className={inputClass} /></Field>
      <Field label="Category">
        <select name="categoryId" defaultValue={product?.categoryId ?? ""} className={inputClass}>
          <option value="">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== "ACTIVE" ? ` (${c.status.toLowerCase()})` : ""}</option>)}
        </select>
      </Field>
      <Field label="Country of origin" help="Two-letter code. Shipping anywhere else requires export eligibility."><input name="originCountry" required maxLength={2} defaultValue={product?.originCountry ?? "NG"} className={`${inputClass} uppercase`} /></Field>
      <Field label="Status" help="Only Active products with an Active price appear in the shop."><Select name="status" options={["DRAFT", "ACTIVE", "ARCHIVED"]} defaultValue={product?.status ?? "DRAFT"} /></Field>
      <Field label="Description" className="sm:col-span-2"><textarea name="description" required minLength={10} rows={4} defaultValue={product?.description} className={inputClass} /></Field>
    </fieldset>
  );
  if (disabled) return fields;
  return product
    ? <ActionForm action={updateProductAction} hidden={{ productId: product.id }} submitLabel="Save product">{fields}</ActionForm>
    : <ActionForm action={createProductAction} submitLabel="Create product">{fields}</ActionForm>;
}
