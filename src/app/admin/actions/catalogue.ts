"use server";

import { adminAction, type ActionState } from "@/lib/admin/action";
import { checkbox, id, money, oneOf, optionalInt, optionalMoney, text } from "@/lib/admin/form";
import { addProductImage, makePrimaryImage, removeProductImage, saveCategory, saveMarketPrice, saveProduct, saveVariant } from "@/lib/admin/catalogue";
import { draftProductDescription } from "@/lib/integrations/ai";
import { uploadProductPhoto } from "@/lib/integrations/storage";
import { recordAudit } from "@/lib/audit";
import { addSize, createProduct, saveSize, setStockCount, type PriceInput } from "@/lib/admin/products";
import { prisma } from "@/lib/prisma";

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

/** Price inputs are named "price:<marketId>", with an optional old price in "was:<marketId>". */
function pricesFrom(form: FormData): PriceInput[] {
  const marketIds = [...new Set([...form.keys()].filter((k) => k.startsWith("price:")).map((k) => k.slice(6)))];
  return marketIds.map((marketId) => {
    try {
      return { marketId, priceMinor: optionalMoney(form, `price:${marketId}`), compareAtMinor: optionalMoney(form, `was:${marketId}`) };
    } catch {
      throw new RangeError("Prices must be numbers, for example 2500 or 2500.50.");
    }
  });
}

function sizeFrom(form: FormData) {
  let weightGrams: number | null;
  try { weightGrams = optionalInt(form, "weightGrams"); } catch { throw new RangeError("Enter the weight in grams as a whole number, for example 500."); }
  return { packSize: text(form, "packSize", 60), weightGrams, sku: text(form, "sku", 40), barcode: text(form, "barcode", 40), prices: pricesFrom(form) };
}

function countFrom(form: FormData, name: string) {
  const raw = text(form, name, 12);
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) throw new RangeError("Enter how many you have as a whole number, for example 24.");
  return Number(raw);
}

/** The one-page "Add a product" form: product, first size, prices, opening stock and photo in one go. */
export async function createProductAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    const name = text(form, "name", 120);
    const file = form.get("file");
    const photo = file instanceof File && file.size > 0 ? { url: await uploadProductPhoto(file), altText: name || "Product photo" } : null;
    const created = await createProduct({
      name,
      description: text(form, "description", 4000),
      categoryId: text(form, "categoryId", 40) || undefined,
      brand: text(form, "brand", 80) || undefined,
      originCountry: text(form, "originCountry", 2) || "NG",
      show: text(form, "show", 10) !== "no",
      openingStock: countFrom(form, "stock"),
      photo,
      ...sizeFrom(form),
    }, staff.id);
    return { message: "Product added.", redirectTo: `/admin/catalogue/${created.id}?added=1` };
  }, { storefront: true });
}

export async function addSizeAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    await addSize(id(form, "productId"), { ...sizeFrom(form), openingStock: countFrom(form, "stock") }, staff.id);
    return "Size added.";
  }, { storefront: true });
}

export async function saveSizeAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    await saveSize(id(form, "variantId"), { ...sizeFrom(form), onSale: checkbox(form, "onSale") }, staff.id);
    return "Saved.";
  }, { storefront: true });
}

export async function setStockAction(_: ActionState, form: FormData) {
  return adminAction("inventory.manage", async (staff) => {
    const result = await setStockCount(id(form, "variantId"), countFrom(form, "stock"), staff.id);
    return result.delta === 0 ? "No change." : `Stock updated: ${result.onHand} in stock.`;
  }, { storefront: true });
}

export async function updateProductAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    await saveProduct(id(form, "productId"), productInput(form), staff.id);
    return "Saved.";
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
    await saveCategory(categoryId, { name: text(form, "name", 60), slug: text(form, "slug", 80), sortOrder: optionalInt(form, "sortOrder") ?? 0, status: oneOf(form, "status", STATUS) }, staff.id);
    return categoryId ? "Category saved." : "Category created.";
  }, { storefront: true });
}

export async function addImageAction(_: ActionState, form: FormData) {
  return adminAction("catalogue.manage", async (staff) => {
    const file = form.get("file");
    const uploading = file instanceof File && file.size > 0;
    if (!uploading && !text(form, "url", 2000)) throw new RangeError("Choose a photo to upload or enter an image address.");
    const url = uploading ? await uploadProductPhoto(file) : text(form, "url", 2000);
    const productId = id(form, "productId");
    const altText = text(form, "altText", 200) || (await prisma.product.findUnique({ where: { id: productId }, select: { name: true } }))?.name || "Product photo";
    await addProductImage(productId, { url, altText }, staff.id);
    return uploading ? "Photo uploaded and added." : "Photo added.";
  }, { storefront: true });
}

export type DraftState = { ok: boolean; message: string; at: number; text?: string } | null;

/** Asks the AI integration for a description draft. The draft goes into the form only; staff decide whether to save it. */
export async function draftDescriptionAction(_: DraftState, form: FormData): Promise<DraftState> {
  let draft = "";
  const state = await adminAction("catalogue.manage", async (staff) => {
    const categoryId = text(form, "categoryId", 40);
    const productId = text(form, "productId", 64);
    const [category, variants] = await Promise.all([
      categoryId ? prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } }) : null,
      productId ? prisma.productVariant.findMany({ where: { productId }, select: { packSize: true } }) : [],
    ]);
    const name = text(form, "name", 120);
    if (name.length < 2) throw new RangeError("Type the product name first, then press Write it for me.");
    const typedSize = text(form, "packSize", 60);
    draft = await draftProductDescription({
      name,
      brand: text(form, "brand", 80) || undefined,
      category: category?.name,
      originCountry: text(form, "originCountry", 2) || undefined,
      packSizes: typedSize ? [typedSize] : variants.map((v) => v.packSize),
      notes: text(form, "description", 1000) || undefined,
    });
    await prisma.$transaction((tx) => recordAudit(tx, { action: "AI_DESCRIPTION_DRAFTED", entityType: "Product", entityId: productId || "new", actorId: staff.id }));
    return "Draft ready. Read it, edit anything that isn't right, then save.";
  }, { revalidate: false });
  return state ? { ...state, text: state.ok ? draft : undefined } : null;
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
