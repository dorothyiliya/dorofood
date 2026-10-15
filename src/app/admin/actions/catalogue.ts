"use server";

import { adminAction, type ActionState } from "@/lib/admin/action";
import { checkbox, id, int, money, oneOf, optionalInt, optionalMoney, text } from "@/lib/admin/form";
import { addProductImage, makePrimaryImage, removeProductImage, saveCategory, saveMarketPrice, saveProduct, saveVariant } from "@/lib/admin/catalogue";

const STATUS = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

function productInput(form: FormData) {
  return {
    name: text(form, "name", 120),
    slug: text(form, "slug", 80),
    description: text(form, "description", 4000),
    brand: text(form, "brand", 80),
    categoryId: text(form, "categoryId", 40),
    originCountry: text(form, "originCountry", 2),
    status: oneOf(form, "status", STATUS),
  };
}

export async function createProductAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    const created = await saveProduct(null, productInput(form), staff.id);
    return { message: "Product created.", redirectTo: `/admin/catalogue/${created.id}` };
  }, { storefront: true });
}

export async function updateProductAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    await saveProduct(id(form, "productId"), productInput(form), staff.id);
    return "Product saved.";
  }, { storefront: true });
}

export async function saveVariantAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    const variantId = text(form, "variantId", 64) || null;
    await saveVariant(id(form, "productId"), variantId, {
      sku: text(form, "sku", 40),
      packSize: text(form, "packSize", 60),
      name: text(form, "variantName", 80),
      barcode: text(form, "barcode", 40),
      weightGrams: optionalInt(form, "weightGrams"),
      status: oneOf(form, "status", STATUS),
    }, staff.id);
    return variantId ? "Variant saved." : "Variant added with zero stock. Receive stock in Inventory.";
  }, { storefront: true });
}

export async function savePriceAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    await saveMarketPrice(id(form, "variantId"), id(form, "marketId"), {
      priceMinor: money(form, "price"),
      compareAtMinor: optionalMoney(form, "compareAt"),
      exportEligible: checkbox(form, "exportEligible"),
      minShelfLifeDays: optionalInt(form, "minShelfLifeDays"),
      restrictionNotes: text(form, "restrictionNotes", 1000),
      status: oneOf(form, "status", STATUS),
    }, staff.id);
    return "Price saved.";
  }, { storefront: true });
}

export async function saveCategoryAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    const categoryId = text(form, "categoryId", 64) || null;
    await saveCategory(categoryId, { name: text(form, "name", 60), slug: text(form, "slug", 80), sortOrder: int(form, "sortOrder"), status: oneOf(form, "status", STATUS) }, staff.id);
    return categoryId ? "Category saved." : "Category created.";
  }, { storefront: true });
}

export async function addImageAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    await addProductImage(id(form, "productId"), { url: text(form, "url", 2000), altText: text(form, "altText", 200) }, staff.id);
    return "Photo added.";
  }, { storefront: true });
}

export async function removeImageAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    await removeProductImage(id(form, "imageId"), staff.id);
    return "Photo removed.";
  }, { storefront: true });
}

export async function primaryImageAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    await makePrimaryImage(id(form, "imageId"), staff.id);
    return "Main photo updated.";
  }, { storefront: true });
}
