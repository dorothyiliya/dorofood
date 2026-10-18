"use server";

import { adminAction, type ActionState } from "@/lib/admin/action";
import { checkbox, id, int, money, oneOf, optionalInt, optionalMoney, text } from "@/lib/admin/form";
import { addProductImage, makePrimaryImage, removeProductImage, saveCategory, saveMarketPrice, saveProduct, saveVariant } from "@/lib/admin/catalogue";
import { draftProductDescription } from "@/lib/integrations/ai";
import { uploadProductPhoto } from "@/lib/integrations/storage";
import { recordAudit } from "@/lib/audit";
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
    const file = form.get("file");
    const uploading = file instanceof File && file.size > 0;
    if (!uploading && !text(form, "url", 2000)) throw new RangeError("Choose a photo to upload or enter an image address.");
    const url = uploading ? await uploadProductPhoto(file) : text(form, "url", 2000);
    await addProductImage(id(form, "productId"), { url, altText: text(form, "altText", 200) }, staff.id);
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
    if (name.length < 2) throw new RangeError("Enter the product name first.");
    draft = await draftProductDescription({
      name,
      brand: text(form, "brand", 80) || undefined,
      category: category?.name,
      originCountry: text(form, "originCountry", 2) || undefined,
      packSizes: variants.map((v) => v.packSize),
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
