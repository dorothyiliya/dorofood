import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, Product } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { CommerceError, isUniqueViolation } from "@/lib/commerce/errors";
import { slugify } from "@/lib/catalogue";
import { getSetting } from "@/lib/settings";
import { changeStock } from "@/lib/admin/stock";

/**
 * The simple product flows used by the admin: everything a shop owner thinks of
 * as "a product" (name, size, prices, stock, photo) is saved in one step, and
 * the technical identifiers (web address, product code) are made automatically.
 * Errors are written for people, not developers.
 */

type Tx = Prisma.TransactionClient;
export type PriceInput = { marketId: string; priceMinor: bigint | null; compareAtMinor?: bigint | null };
export type SizeInput = { packSize: string; weightGrams?: number | null; sku?: string; barcode?: string; prices: PriceInput[] };

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CommerceError("INVALID_INPUT", 422, message);
}

export async function uniqueProductSlug(db: Tx | typeof prisma, name: string, ignoreId?: string) {
  const root = slugify(name).slice(0, 70) || "product";
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const found = await db.product.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!found || found.id === ignoreId) return candidate;
  }
  return `${root}-${randomBytes(3).toString("hex")}`;
}

/** e.g. "PLANTA-CHIPS-150G-3F9A": readable, unique enough, and the database enforces uniqueness. */
function autoSku(name: string, size: string) {
  const words = `${name} ${size}`.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const stem = words.slice(0, 4).map((w) => w.slice(0, 6)).join("-").slice(0, 30) || "ITEM";
  return `${stem}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

/** Where stock is kept. Created as "Main store" the first time it is needed, so nobody has to set up "locations". */
export async function fulfilmentLocation(db: Tx, actorId: string) {
  const code = await getSetting("fulfilment.locationCode", db);
  const existing = await db.inventoryLocation.findUnique({ where: { code } });
  if (existing) return existing;
  const created = await db.inventoryLocation.create({ data: { code, name: "Main store", addressJson: {} } });
  await recordAudit(db, { action: "LOCATION_CREATED", entityType: "InventoryLocation", entityId: created.id, actorId, metadata: { code, automatic: true } });
  return created;
}

function normaliseSize(input: SizeInput) {
  const packSize = input.packSize.trim();
  check(packSize.length > 0, "Enter the size, for example 500 g, 1 litre or Pack of 6.");
  check(packSize.length <= 60, "The size is too long. Keep it short, for example 500 g.");
  check(input.weightGrams === null || input.weightGrams === undefined || (Number.isInteger(input.weightGrams) && input.weightGrams > 0 && input.weightGrams <= 1_000_000), "Enter the weight in grams as a whole number, for example 500.");
  const sku = input.sku?.trim().toUpperCase();
  check(!sku || /^[A-Z0-9][A-Z0-9-]{1,39}$/.test(sku), "The product code can only use letters, numbers and dashes. Leave it empty to create one automatically.");
  const barcode = input.barcode?.trim() || null;
  check(!barcode || barcode.length <= 40, "The barcode is too long.");
  for (const p of input.prices) {
    check(p.priceMinor === null || p.priceMinor > BigInt(0), "Prices must be more than zero.");
    check(!p.compareAtMinor || (p.priceMinor !== null && p.compareAtMinor > p.priceMinor), "The old price must be higher than the selling price.");
  }
  check(input.prices.some((p) => p.priceMinor !== null), "Enter at least one price.");
  return { packSize, weightGrams: input.weightGrams ?? null, sku: sku || null, barcode };
}

/**
 * Prices for one size. Giving a price in a market means "sell it there": for a
 * market outside the product's country of origin that also means it may be
 * exported there. Clearing a price stops selling it in that market.
 */
async function writePrices(tx: Tx, product: Pick<Product, "originCountry">, variantId: string, prices: PriceInput[], actorId: string) {
  const markets = await tx.market.findMany({ where: { id: { in: prices.map((p) => p.marketId) } } });
  for (const p of prices) {
    const market = markets.find((m) => m.id === p.marketId);
    check(market, "One of the countries no longer exists. Reload the page and try again.");
    const existing = await tx.marketProduct.findUnique({ where: { marketId_variantId: { marketId: market.id, variantId } } });
    if (p.priceMinor === null) {
      if (existing && existing.status !== "ARCHIVED") await tx.marketProduct.update({ where: { id: existing.id }, data: { status: "ARCHIVED" } });
      continue;
    }
    const data = { priceMinor: p.priceMinor, compareAtMinor: p.compareAtMinor ?? null, currency: market.currency, exportEligible: market.countryCode !== product.originCountry, status: "ACTIVE" as const };
    if (existing) await tx.marketProduct.update({ where: { id: existing.id }, data });
    else await tx.marketProduct.create({ data: { ...data, marketId: market.id, variantId } });
    if (existing?.priceMinor !== p.priceMinor) {
      await recordAudit(tx, { action: "PRICE_SAVED", entityType: "ProductVariant", entityId: variantId, actorId, metadata: { market: market.code, fromMinor: existing?.priceMinor ?? null, toMinor: p.priceMinor } });
    }
  }
}

async function createSize(tx: Tx, product: Product, size: ReturnType<typeof normaliseSize>, prices: PriceInput[], openingStock: number, actorId: string) {
  const variant = await tx.productVariant.create({
    data: { productId: product.id, sku: size.sku ?? autoSku(product.name, size.packSize), packSize: size.packSize, weightGrams: size.weightGrams, barcode: size.barcode, status: "ACTIVE" },
  });
  await writePrices(tx, product, variant.id, prices, actorId);
  const location = await fulfilmentLocation(tx, actorId);
  await tx.inventoryBalance.create({ data: { variantId: variant.id, locationId: location.id, quantityOnHand: openingStock } });
  if (openingStock > 0) {
    await tx.inventoryMovement.create({ data: { variantId: variant.id, locationId: location.id, quantityDelta: openingStock, reason: "RECEIPT", note: "Opening stock", reference: "admin", actorId } });
  }
  await recordAudit(tx, { action: "VARIANT_CREATED", entityType: "ProductVariant", entityId: variant.id, actorId, metadata: { packSize: size.packSize, sku: variant.sku, openingStock } });
  return variant;
}

function friendlyUnique(error: unknown): never {
  if (isUniqueViolation(error, "sku")) throw new CommerceError("DUPLICATE", 409, "That product code is already used by another product. Leave it empty to create one automatically.");
  if (isUniqueViolation(error, "barcode")) throw new CommerceError("DUPLICATE", 409, "Another product already has this barcode.");
  throw error;
}

function checkStock(n: number) {
  check(Number.isInteger(n) && n >= 0 && n <= 1_000_000, "Enter how many you have as a whole number (0 or more).");
}

export async function createProduct(
  input: { name: string; description: string; categoryId?: string; brand?: string; originCountry?: string; show: boolean; openingStock: number; photo?: { url: string; altText: string } | null } & SizeInput,
  actorId: string,
) {
  const name = input.name.trim();
  const description = input.description.trim();
  const originCountry = (input.originCountry || "NG").trim().toUpperCase();
  check(name.length >= 2, "Enter the product name.");
  check(name.length <= 120, "The product name is too long.");
  check(description.length >= 10, "Write a short description, at least a few words, so customers know what they are buying.");
  check(description.length <= 4000, "The description is too long.");
  check(/^[A-Z]{2}$/.test(originCountry), "Choose the country the product is made in.");
  checkStock(input.openingStock);
  const size = normaliseSize(input);
  if (input.categoryId) check(await prisma.category.findUnique({ where: { id: input.categoryId } }), "That category no longer exists. Reload the page.");

  try {
    return await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: { name, description, slug: await uniqueProductSlug(tx, name), brand: input.brand?.trim() || null, categoryId: input.categoryId || null, originCountry, status: input.show ? "ACTIVE" : "DRAFT" },
      });
      await createSize(tx, product, size, input.prices, input.openingStock, actorId);
      if (input.photo) await tx.productMedia.create({ data: { productId: product.id, url: input.photo.url, altText: input.photo.altText, sortOrder: 0 } });
      await recordAudit(tx, { action: "PRODUCT_CREATED", entityType: "Product", entityId: product.id, actorId, metadata: { name, show: input.show, photo: Boolean(input.photo) } });
      return product;
    }, { timeout: 20_000 });
  } catch (error) {
    friendlyUnique(error);
  }
}

export async function addSize(productId: string, input: SizeInput & { openingStock: number }, actorId: string) {
  checkStock(input.openingStock);
  const size = normaliseSize(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      check(product, "That product no longer exists.");
      return createSize(tx, product, size, input.prices, input.openingStock, actorId);
    }, { timeout: 20_000 });
  } catch (error) {
    friendlyUnique(error);
  }
}

export async function saveSize(variantId: string, input: SizeInput & { onSale: boolean }, actorId: string) {
  const size = normaliseSize(input);
  try {
    await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
      check(variant, "That size no longer exists.");
      await tx.productVariant.update({
        where: { id: variantId },
        data: { packSize: size.packSize, weightGrams: size.weightGrams, barcode: size.barcode, ...(size.sku ? { sku: size.sku } : {}), status: input.onSale ? "ACTIVE" : "ARCHIVED" },
      });
      await writePrices(tx, variant.product, variantId, input.prices, actorId);
      await recordAudit(tx, { action: "VARIANT_UPDATED", entityType: "ProductVariant", entityId: variantId, actorId, metadata: { packSize: size.packSize, onSale: input.onSale } });
    }, { timeout: 20_000 });
  } catch (error) {
    friendlyUnique(error);
  }
}

/** "How many do you have now?": records the difference as a stock count. */
export async function setStockCount(variantId: string, count: number, actorId: string) {
  checkStock(count);
  const location = await prisma.$transaction((tx) => fulfilmentLocation(tx, actorId));
  return changeStock({ variantId, locationId: location.id, mode: "count", quantity: count, reason: "STOCKTAKE", note: "Updated from the product page" }, actorId);
}
