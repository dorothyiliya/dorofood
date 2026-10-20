import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { CommerceError } from "@/lib/commerce/errors";

/** Markets are managed in the admin; the code only has to look like one. Existence is checked against the database. */
/** Market codes: a letter, then letters or digits, 2-12 characters (NG, NGUSD, OTHER, EU2). */
export const MARKET_CODE = /^[A-Z][A-Z0-9]{1,11}$/;
export const marketCodeSchema = z.string().trim().toUpperCase().regex(MARKET_CODE, "Unknown market.");
export const countryCodeSchema = z.string().trim().regex(/^[A-Za-z]{2}$/, "Use a two-letter ISO country code.").transform((v) => v.toUpperCase());
export const cartItemsSchema = z.array(z.object({
  variantId: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(50),
})).min(1).max(50);

export type CartItemInput = z.infer<typeof cartItemsSchema>[number];

/** Collapse repeated variant lines so a client cannot bypass per-line limits. */
export function mergeItems(items: CartItemInput[]) {
  const merged = new Map<string, number>();
  for (const item of items) merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
  for (const [variantId, quantity] of merged) {
    if (quantity > 50) throw new CommerceError("QUANTITY_LIMIT", 422, "A maximum of 50 units per product is allowed.", { variantId });
  }
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId));
}

export type PricedLine = {
  variantId: string;
  quantity: number;
  unitPriceMinor: bigint;
  lineTotalMinor: bigint;
  productName: string;
  sku: string;
  packSize: string;
  originCountry: string;
  exportEligible: boolean;
};

export type PricedCart = {
  market: { id: string; code: string; currency: string };
  destinationCountry: string;
  lines: PricedLine[];
  subtotalMinor: bigint;
  shippingMinor: bigint;
  totalMinor: bigint;
  currency: string;
  requiresExport: boolean;
};

/**
 * The single authority for what an order costs and whether it may ship. Prices
 * come only from the database; the client supplies variant ids and quantities.
 * Fails closed: no active market, no enabled shipping rule with an explicit
 * rate, or any item not sellable/eligible for the destination -> error.
 */
export async function priceCart(
  db: Prisma.TransactionClient,
  input: { marketCode: string; countryCode: string; items: CartItemInput[] },
): Promise<PricedCart> {
  const items = mergeItems(input.items);
  const market = await db.market.findUnique({ where: { code: input.marketCode } });
  if (!market || market.status !== "ACTIVE") {
    throw new CommerceError("MARKET_UNAVAILABLE", 422, "We are not taking orders for this market yet.");
  }
  if (market.code !== "OTHER" && market.countryCode !== input.countryCode) {
    throw new CommerceError("DESTINATION_MARKET_MISMATCH", 422, "The delivery country does not match the selected market.");
  }

  const rule = await db.shippingRule.findFirst({
    where: { marketId: market.id, countryCode: input.countryCode, enabled: true, flatRateMinor: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  if (!rule || rule.flatRateMinor === null || rule.currency !== market.currency) {
    throw new CommerceError("SHIPPING_UNAVAILABLE", 422, "Delivery to this destination is not available yet.");
  }

  const marketProducts = await db.marketProduct.findMany({
    where: { marketId: market.id, variantId: { in: items.map((i) => i.variantId) } },
    include: { variant: { include: { product: true } } },
  });
  const byVariant = new Map(marketProducts.map((mp) => [mp.variantId, mp]));

  const unavailable: string[] = [];
  const ineligible: string[] = [];
  const lines: PricedLine[] = [];
  let weightGrams = 0;
  let weightKnown = true;

  for (const item of items) {
    const mp = byVariant.get(item.variantId);
    if (!mp || mp.status !== "ACTIVE" || mp.variant.status !== "ACTIVE" || mp.variant.product.status !== "ACTIVE" || mp.currency !== market.currency) {
      unavailable.push(item.variantId);
      continue;
    }
    if (input.countryCode !== mp.variant.product.originCountry && !mp.exportEligible) {
      ineligible.push(item.variantId);
      continue;
    }
    if (mp.variant.weightGrams == null) weightKnown = false;
    else weightGrams += mp.variant.weightGrams * item.quantity;
    lines.push({
      variantId: item.variantId,
      quantity: item.quantity,
      unitPriceMinor: mp.priceMinor,
      lineTotalMinor: mp.priceMinor * BigInt(item.quantity),
      productName: mp.variant.product.name,
      sku: mp.variant.sku,
      packSize: mp.variant.packSize,
      originCountry: mp.variant.product.originCountry,
      exportEligible: mp.exportEligible,
    });
  }

  if (unavailable.length) throw new CommerceError("ITEM_UNAVAILABLE", 422, "Some items are not available in this market.", { variantIds: unavailable });
  if (ineligible.length) throw new CommerceError("NOT_ELIGIBLE_FOR_DESTINATION", 422, "Some items cannot be shipped to this destination.", { variantIds: ineligible });
  if (rule.maxWeightGrams != null && (!weightKnown || weightGrams > rule.maxWeightGrams)) {
    throw new CommerceError("SHIPPING_UNAVAILABLE", 422, "This order exceeds the delivery weight limit or has unknown weights.");
  }

  const subtotalMinor = lines.reduce((sum, l) => sum + l.lineTotalMinor, BigInt(0));
  if (rule.minOrderMinor != null && subtotalMinor < rule.minOrderMinor) {
    throw new CommerceError("MINIMUM_ORDER_NOT_MET", 422, "The order is below the minimum for this destination.", { minimumMinor: rule.minOrderMinor.toString() });
  }

  return {
    market: { id: market.id, code: market.code, currency: market.currency },
    destinationCountry: input.countryCode,
    lines,
    subtotalMinor,
    shippingMinor: rule.flatRateMinor,
    totalMinor: subtotalMinor + rule.flatRateMinor,
    currency: market.currency,
    requiresExport: lines.some((l) => l.originCountry !== input.countryCode),
  };
}
