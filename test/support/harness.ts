import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { FakePaystack } from "./fake-paystack";
import { POST as checkoutRoute } from "@/app/api/v1/checkout/route";
import { POST as quoteRoute } from "@/app/api/v1/checkout/quotes/route";
import { GET as productsRoute } from "@/app/api/v1/products/route";
import { POST as verifyRoute } from "@/app/api/v1/payments/verify/route";
import { POST as webhookRoute } from "@/app/api/v1/webhooks/paystack/route";
import { POST as reconcileRoute } from "@/app/api/internal/jobs/reconcile/route";

export { prisma };

/** Starts a fake Paystack for the file and resets database + provider state before every test. */
export function setupIntegrationHarness() {
  const paystack = new FakePaystack();
  beforeAll(async () => {
    await paystack.start();
    process.env.PAYSTACK_SECRET_KEY = paystack.secret;
    process.env.PAYSTACK_API_BASE_URL = paystack.baseUrl;
  });
  afterAll(async () => {
    await paystack.stop();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    paystack.reset();
    process.env.PAYSTACK_SECRET_KEY = paystack.secret;
    process.env.PAYSTACK_API_BASE_URL = paystack.baseUrl;
    process.env.CHECKOUT_ENABLED = "true";
    await resetDatabase();
  });
  return paystack;
}

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export type Fixture = Awaited<ReturnType<typeof seedFixture>>;

/**
 * Two Nigerian-origin products: "crisps" (NG only) and "tea" (export eligible to GB).
 * NG delivery N1,500 flat; GB delivery GBP 12.00 flat.
 */
export async function seedFixture({ crispsStock = 10, teaStock = 10 } = {}) {
  const ng = await prisma.market.create({ data: { code: "NG", name: "Nigeria", countryCode: "NG", currency: "NGN", status: "ACTIVE" } });
  const gb = await prisma.market.create({ data: { code: "GB", name: "United Kingdom", countryCode: "GB", currency: "GBP", status: "ACTIVE" } });
  const location = await prisma.inventoryLocation.create({ data: { code: "NG-MAIN", name: "Main", addressJson: {} } });
  await prisma.shippingRule.create({ data: { marketId: ng.id, countryCode: "NG", providerCode: "TEST", enabled: true, flatRateMinor: BigInt(150_000), currency: "NGN" } });
  await prisma.shippingRule.create({ data: { marketId: gb.id, countryCode: "GB", providerCode: "TEST", enabled: true, flatRateMinor: BigInt(1_200), currency: "GBP" } });

  async function product(slug: string, name: string, stock: number, ngPrice: number, gbPrice: number, exportEligible: boolean) {
    const p = await prisma.product.create({ data: { slug, name, description: name, status: "ACTIVE", originCountry: "NG" } });
    const v = await prisma.productVariant.create({ data: { productId: p.id, sku: slug.toUpperCase(), packSize: "1 pack", weightGrams: 200, status: "ACTIVE" } });
    await prisma.marketProduct.create({ data: { marketId: ng.id, variantId: v.id, priceMinor: BigInt(ngPrice), currency: "NGN", status: "ACTIVE" } });
    await prisma.marketProduct.create({ data: { marketId: gb.id, variantId: v.id, priceMinor: BigInt(gbPrice), currency: "GBP", status: "ACTIVE", exportEligible } });
    await prisma.inventoryBalance.create({ data: { variantId: v.id, locationId: location.id, quantityOnHand: stock } });
    return v.id;
  }

  return {
    location,
    crisps: await product("crisps", "Plantain Crisps", crispsStock, 185_000, 650, false),
    tea: await product("tea", "Citrus Tea", teaStock, 390_000, 900, true),
  };
}

export function idempotencyKey() {
  return `test_${randomBytes(12).toString("hex")}`;
}

export function checkoutBody(items: { variantId: string; quantity: number }[], overrides: { market?: string; countryCode?: string; email?: string } = {}) {
  return {
    email: overrides.email ?? "customer@example.com",
    market: overrides.market ?? "NG",
    shippingAddress: { recipient: "Ada Customer", phone: "+2348000000000", line1: "1 Test Street", city: "Lagos", countryCode: overrides.countryCode ?? "NG" },
    items,
  };
}

function json(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

export const api = {
  async products(query = "") {
    const res = await productsRoute(new Request(`http://localhost/api/v1/products${query}`));
    return { status: res.status, body: await res.json() };
  },
  async quote(body: unknown) {
    const res = await quoteRoute(json("http://localhost/api/v1/checkout/quotes", body));
    return { status: res.status, body: await res.json() };
  },
  async checkout(body: unknown, key: string | null = idempotencyKey()) {
    const res = await checkoutRoute(json("http://localhost/api/v1/checkout", body, key ? { "Idempotency-Key": key } : {}));
    return { status: res.status, body: await res.json() };
  },
  async verify(reference: string) {
    const res = await verifyRoute(json("http://localhost/api/v1/payments/verify", { reference }));
    return { status: res.status, body: await res.json() };
  },
  async webhook(delivery: { body: string; signature: string | null }) {
    const res = await webhookRoute(json("http://localhost/api/v1/webhooks/paystack", delivery.body, delivery.signature ? { "x-paystack-signature": delivery.signature } : {}));
    return { status: res.status, body: await res.json() };
  },
  async reconcile(authorization: string | null = `Bearer ${process.env.CRON_SECRET}`) {
    const res = await reconcileRoute(new Request("http://localhost/api/internal/jobs/reconcile", { method: "POST", headers: authorization ? { authorization } : {} }));
    return { status: res.status, body: await res.json() };
  },
};

export async function orderByNumber(orderNumber: string) {
  return prisma.order.findUniqueOrThrow({ where: { orderNumber }, include: { reservations: true, payments: { include: { refunds: true } }, shipments: true, exportRecord: true } });
}

export async function balance(variantId: string) {
  return prisma.inventoryBalance.findFirstOrThrow({ where: { variantId } });
}

/** reserved == sum(ACTIVE + COMMITTED reservations) and 0 <= reserved <= on hand, for every balance. */
export async function inventoryInvariantViolations() {
  return prisma.$queryRaw<unknown[]>`
    SELECT b."variantId", b."quantityOnHand", b."reservedQuantity", COALESCE(SUM(r.quantity), 0)::int AS held
    FROM "InventoryBalance" b
    LEFT JOIN "InventoryReservation" r
      ON r."variantId" = b."variantId" AND r."locationId" = b."locationId" AND r.status IN ('ACTIVE', 'COMMITTED')
    GROUP BY b.id
    HAVING b."reservedQuantity" <> COALESCE(SUM(r.quantity), 0) OR b."reservedQuantity" < 0 OR b."reservedQuantity" > b."quantityOnHand"`;
}

/** Moves an order's payment window into the past, as if the customer walked away. */
export async function expirePaymentWindow(orderNumber: string) {
  const past = new Date(Date.now() - 60 * 60_000);
  const order = await prisma.order.update({ where: { orderNumber }, data: { paymentExpiresAt: past } });
  await prisma.inventoryReservation.updateMany({ where: { orderId: order.id }, data: { expiresAt: past } });
  await prisma.paymentTransaction.updateMany({ where: { orderId: order.id }, data: { createdAt: new Date(Date.now() - 2 * 60 * 60_000) } });
}
