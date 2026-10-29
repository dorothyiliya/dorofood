import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { CommerceError, isUniqueViolation } from "@/lib/commerce/errors";
import { getSetting } from "@/lib/settings";
import { slugify } from "@/lib/catalogue";
import { uniqueProductSlug } from "@/lib/admin/products";

const status = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "The web address can only use lowercase letters, numbers and single dashes.").max(80);
/** Empty means "make one from the name" (or keep the current one when editing). */
const optionalSlug = z.union([z.literal(""), slug]).optional().transform((v) => v || null);
const optional = (schema: z.ZodString) => schema.optional().transform((v) => v || null);

export const productSchema = z.object({
  name: z.string().trim().min(2, "Enter the product name.").max(120),
  slug: optionalSlug,
  description: z.string().trim().min(10, "Write a short description, at least a few words.").max(4000),
  brand: optional(z.string().trim().max(80)),
  categoryId: optional(z.string().trim().max(40)),
  originCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Choose the country the product is made in."),
  status,
  seoTitle: z.string().trim().max(120).optional().transform((v) => v || null),
  seoDescription: z.string().trim().max(320).optional().transform((v) => v || null),
});

export const variantSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, "Use letters, numbers and hyphens."),
  packSize: z.string().trim().min(1).max(60),
  name: optional(z.string().trim().max(80)),
  barcode: optional(z.string().trim().max(40)),
  weightGrams: z.number().int().min(1).max(1_000_000).nullable(),
  status,
});

export const marketPriceSchema = z.object({
  priceMinor: z.bigint().positive(),
  compareAtMinor: z.bigint().positive().nullable(),
  exportEligible: z.boolean(),
  minShelfLifeDays: z.number().int().min(0).max(3650).nullable(),
  restrictionNotes: optional(z.string().trim().max(1000)),
  status,
});

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Enter the category name.").max(60),
  slug: optionalSlug,
  sortOrder: z.number().int().min(0).max(10_000),
  status,
});

function uniqueError(error: unknown, field: string, message: string): never {
  if (isUniqueViolation(error, field)) throw new CommerceError("DUPLICATE", 409, message);
  throw error;
}

export async function saveProduct(id: string | null, input: z.input<typeof productSchema>, actorId: string) {
  const data = productSchema.parse(input);
  if (data.categoryId && !(await prisma.category.findUnique({ where: { id: data.categoryId } }))) {
    throw new CommerceError("CATEGORY_NOT_FOUND", 422, "Choose an existing category.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const current = id ? await tx.product.findUnique({ where: { id }, select: { slug: true } }) : null;
      const record = { ...data, slug: data.slug ?? current?.slug ?? (await uniqueProductSlug(tx, data.name)) };
      const product = id ? await tx.product.update({ where: { id }, data: record }) : await tx.product.create({ data: record });
      await recordAudit(tx, { action: id ? "PRODUCT_UPDATED" : "PRODUCT_CREATED", entityType: "Product", entityId: product.id, actorId, metadata: data });
      return product;
    });
  } catch (error) {
    uniqueError(error, "slug", "Another product already uses this web address. Change it, or leave it empty.");
  }
}

export async function saveVariant(productId: string, id: string | null, input: z.input<typeof variantSchema>, actorId: string) {
  const data = variantSchema.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      if (id) {
        const existing = await tx.productVariant.findUnique({ where: { id } });
        if (!existing || existing.productId !== productId) throw new CommerceError("VARIANT_NOT_FOUND", 404, "Variant not found.");
      }
      const variant = id ? await tx.productVariant.update({ where: { id }, data }) : await tx.productVariant.create({ data: { ...data, productId } });
      if (!id) {
        // Give the new variant a zero balance at the fulfilment location so stock can be received.
        const location = await tx.inventoryLocation.findUnique({ where: { code: await getSetting("fulfilment.locationCode", tx) } });
        if (location) await tx.inventoryBalance.create({ data: { variantId: variant.id, locationId: location.id } });
      }
      await recordAudit(tx, { action: id ? "VARIANT_UPDATED" : "VARIANT_CREATED", entityType: "ProductVariant", entityId: variant.id, actorId, metadata: data });
      return variant;
    });
  } catch (error) {
    if (isUniqueViolation(error, "barcode")) throw new CommerceError("DUPLICATE", 409, "Another variant already uses this barcode.");
    uniqueError(error, "sku", "Another variant already uses this SKU.");
  }
}

export async function saveMarketPrice(variantId: string, marketId: string, input: z.input<typeof marketPriceSchema>, actorId: string) {
  const data = marketPriceSchema.parse(input);
  if (data.compareAtMinor !== null && data.compareAtMinor <= data.priceMinor) {
    throw new CommerceError("INVALID_COMPARE_AT", 422, "The compare-at price must be higher than the price.");
  }
  const market = await prisma.market.findUnique({ where: { id: marketId } });
  if (!market) throw new CommerceError("MARKET_NOT_FOUND", 404, "Market not found.");
  return prisma.$transaction(async (tx) => {
    const before = await tx.marketProduct.findUnique({ where: { marketId_variantId: { marketId, variantId } } });
    const row = await tx.marketProduct.upsert({
      where: { marketId_variantId: { marketId, variantId } },
      create: { ...data, marketId, variantId, currency: market.currency },
      update: { ...data, currency: market.currency },
    });
    await recordAudit(tx, {
      action: "PRICE_SAVED", entityType: "ProductVariant", entityId: variantId, actorId,
      metadata: { market: market.code, fromMinor: before?.priceMinor ?? null, toMinor: data.priceMinor, exportEligible: data.exportEligible, status: data.status },
    });
    return row;
  });
}

export async function saveCategory(id: string | null, input: z.input<typeof categorySchema>, actorId: string) {
  const data = categorySchema.parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const current = id ? await tx.category.findUnique({ where: { id }, select: { slug: true } }) : null;
      let slugValue = data.slug ?? current?.slug ?? null;
      if (!slugValue) {
        const root = slugify(data.name) || "category";
        slugValue = root;
        for (let i = 2; await tx.category.findUnique({ where: { slug: slugValue } }); i++) slugValue = `${root}-${i}`;
      }
      const record = { ...data, slug: slugValue };
      const category = id ? await tx.category.update({ where: { id }, data: record }) : await tx.category.create({ data: record });
      await recordAudit(tx, { action: id ? "CATEGORY_UPDATED" : "CATEGORY_CREATED", entityType: "Category", entityId: category.id, actorId, metadata: data });
      return category;
    });
  } catch (error) {
    uniqueError(error, "slug", "Another category already uses this web address. Change it, or leave it empty.");
  }
}

export const productImageSchema = z.object({
  url: z.string().trim().max(2000).url().refine((u) => u.startsWith("https://"), "Use an https:// image address."),
  altText: z.string().trim().min(3, "Describe the photo in a few words.").max(200),
});

/** Photos are stored by URL (uploaded through Photo storage, or any https address). The first photo is the main one in the shop. */
export async function addProductImage(productId: string, input: z.input<typeof productImageSchema>, actorId: string) {
  const data = productImageSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const count = await tx.productMedia.count({ where: { productId } });
    if (count >= 8) throw new CommerceError("TOO_MANY_IMAGES", 422, "A product can have up to 8 photos.");
    const image = await tx.productMedia.create({ data: { productId, url: data.url, altText: data.altText, sortOrder: count } });
    await recordAudit(tx, { action: "PRODUCT_IMAGE_ADDED", entityType: "Product", entityId: productId, actorId, metadata: { url: data.url } });
    return image;
  });
}

export async function removeProductImage(imageId: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const image = await tx.productMedia.findUnique({ where: { id: imageId } });
    if (!image) throw new CommerceError("IMAGE_NOT_FOUND", 404, "Photo not found.");
    await tx.productMedia.delete({ where: { id: imageId } });
    const rest = await tx.productMedia.findMany({ where: { productId: image.productId }, orderBy: { sortOrder: "asc" } });
    for (const [i, m] of rest.entries()) if (m.sortOrder !== i) await tx.productMedia.update({ where: { id: m.id }, data: { sortOrder: i } });
    await recordAudit(tx, { action: "PRODUCT_IMAGE_REMOVED", entityType: "Product", entityId: image.productId, actorId, metadata: { url: image.url } });
  });
}

export async function makePrimaryImage(imageId: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const image = await tx.productMedia.findUnique({ where: { id: imageId } });
    if (!image) throw new CommerceError("IMAGE_NOT_FOUND", 404, "Photo not found.");
    const ordered = await tx.productMedia.findMany({ where: { productId: image.productId }, orderBy: { sortOrder: "asc" } });
    const next = [image, ...ordered.filter((m) => m.id !== imageId)];
    for (const [i, m] of next.entries()) await tx.productMedia.update({ where: { id: m.id }, data: { sortOrder: i } });
    await recordAudit(tx, { action: "PRODUCT_IMAGE_PRIMARY", entityType: "Product", entityId: image.productId, actorId, metadata: { url: image.url } });
  });
}
