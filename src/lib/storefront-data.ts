import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { getSettings, SETTINGS } from "@/lib/settings";
import { gatewayReady } from "@/lib/payments/gateway";
import { DEFAULT_PAYMENT_PROVIDER } from "@/lib/integrations/definitions";
import { categoryIcon, packFor, sampleProducts, slugify, summariseCategories, type CategorySummary, type Product } from "@/lib/catalogue";

export type MarketSummary = { code: string; name: string; currency: string; countryCode: string; delivers: boolean; flatRateMinor: string | null };

export type StorefrontData = {
  products: Product[];
  categories: CategorySummary[];
  markets: MarketSummary[];
  homeMarket: string;
  announcement: string;
  previewMode: boolean;
  contactEmail: string;
  checkoutLive: boolean;
  paymentWindowMinutes: number;
  source: "database" | "sample";
};

const HOME_MARKET = "NG";

const SAMPLE_MARKETS: MarketSummary[] = [
  { code: "NG", name: "Nigeria", currency: "NGN", countryCode: "NG", delivers: false, flatRateMinor: null },
  { code: "GB", name: "United Kingdom", currency: "GBP", countryCode: "GB", delivers: false, flatRateMinor: null },
  { code: "US", name: "United States", currency: "USD", countryCode: "US", delivers: false, flatRateMinor: null },
  { code: "CA", name: "Canada", currency: "CAD", countryCode: "CA", delivers: false, flatRateMinor: null },
];

function sample(settings: { announcement: string; contactEmail: string }): StorefrontData {
  return {
    products: sampleProducts,
    categories: summariseCategories(sampleProducts),
    markets: SAMPLE_MARKETS,
    homeMarket: HOME_MARKET,
    announcement: settings.announcement,
    previewMode: true,
    contactEmail: settings.contactEmail,
    checkoutLive: false,
    paymentWindowMinutes: SETTINGS["checkout.paymentWindowMinutes"].default,
    source: "sample",
  };
}

/** True only when every switch for taking orders is on. Reveals no configuration detail. */
async function checkoutSwitchesOn(storeOpen: boolean, homeProvider: string) {
  return storeOpen && process.env.CHECKOUT_ENABLED === "true" && (await gatewayReady(homeProvider));
}

/**
 * Everything the storefront renders, from the database. Sample products are
 * shown only when there is no database, or the catalogue is empty and the
 * store is explicitly in preview mode.
 */
export const loadStorefront = cache(async function loadStorefront(): Promise<StorefrontData> {
  const defaults = { announcement: SETTINGS["storefront.announcement"].default, contactEmail: SETTINGS["store.contactEmail"].default };
  if (!isDatabaseConfigured()) return sample(defaults);
  try {
    const settings = await getSettings();
    const [markets, categoryRows] = await Promise.all([
      prisma.market.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" }, include: { shippingRules: { where: { enabled: true, flatRateMinor: { not: null } } } } }),
      prisma.category.findMany({ where: { status: "ACTIVE" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    ]);
    const home = markets.find((m) => m.code === HOME_MARKET);
    const variants = home ? await prisma.productVariant.findMany({
      where: { status: "ACTIVE", product: { status: "ACTIVE" }, marketProducts: { some: { marketId: home.id, status: "ACTIVE" } } },
      include: {
        product: { include: { category: true, media: { orderBy: { sortOrder: "asc" } } } },
        marketProducts: { where: { status: "ACTIVE", market: { status: "ACTIVE" } }, include: { market: true } },
        balances: { where: { location: { code: settings["fulfilment.locationCode"] } } },
      },
      orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    }) : [];

    const storeSettings = { announcement: settings["storefront.announcement"], contactEmail: settings["store.contactEmail"] };
    if (variants.length === 0 && settings["storefront.previewMode"]) return sample(storeSettings);

    const products: Product[] = variants.map((v, position) => {
      const homePrice = v.marketProducts.find((mp) => mp.market.code === HOME_MARKET)!;
      const category = v.product.category?.status === "ACTIVE" ? v.product.category.name : "Other";
      const balance = v.balances[0];
      return {
        id: v.id,
        slug: v.product.slug,
        name: v.product.name,
        brand: v.product.brand ?? "",
        category,
        categorySlug: v.product.category?.status === "ACTIVE" ? v.product.category.slug : slugify(category),
        size: v.packSize,
        priceKobo: Number(homePrice.priceMinor),
        compareAtKobo: homePrice.compareAtMinor ? Number(homePrice.compareAtMinor) : undefined,
        description: v.product.description,
        images: v.product.media.map((m) => ({ url: m.url, alt: m.altText })),
        pack: packFor(v.product.slug, position),
        icon: categoryIcon(category),
        origin: v.product.originCountry,
        shipsTo: v.marketProducts.filter((mp) => mp.market.countryCode === v.product.originCountry || mp.exportEligible).map((mp) => mp.market.code),
        available: balance ? balance.quantityOnHand - balance.reservedQuantity > 0 : false,
        addedAt: v.createdAt.toISOString(),
      };
    });

    return {
      products,
      categories: summariseCategories(products, categoryRows.map((c) => c.name)),
      markets: [...markets].sort((a, b) => Number(b.code === HOME_MARKET) - Number(a.code === HOME_MARKET) || a.name.localeCompare(b.name)).map((m) => {
        const rule = m.shippingRules.find((r) => r.countryCode === m.countryCode) ?? m.shippingRules[0];
        return { code: m.code, name: m.name, currency: m.currency, countryCode: m.countryCode, delivers: Boolean(rule), flatRateMinor: rule?.flatRateMinor?.toString() ?? null };
      }),
      homeMarket: HOME_MARKET,
      ...storeSettings,
      previewMode: settings["storefront.previewMode"],
      checkoutLive: await checkoutSwitchesOn(settings["checkout.open"], home?.paymentProvider ?? DEFAULT_PAYMENT_PROVIDER),
      paymentWindowMinutes: settings["checkout.paymentWindowMinutes"],
      source: "database",
    };
  } catch (error) {
    console.error("[storefront] falling back to sample catalogue", (error as Error).message);
    return sample(defaults);
  }
});

export async function loadProduct(slug: string) {
  const data = await loadStorefront();
  const product = data.products.find((p) => p.slug === slug) ?? null;
  return { data, product };
}
