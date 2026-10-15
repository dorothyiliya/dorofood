/**
 * Production-build smoke test: runs `next start` against a *_test database and
 * the fake Paystack, then walks the customer journey over real HTTP.
 * Requires `npm run build` first.  Usage: npm run test:smoke
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { FakePaystack } from "../test/support/fake-paystack";
import { testDatabaseUrl } from "../test/support/test-database";

const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL = testDatabaseUrl();
const CRON_SECRET = "smoke-cron-secret-0123456789abcdef012345";
let failures = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`);
}

async function startServer(env: Record<string, string | undefined>) {
  const server = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    env: { ...process.env, PAYSTACK_SECRET_KEY: undefined, CHECKOUT_ENABLED: undefined, ...env, DATABASE_URL, NODE_ENV: "production" } as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => process.env.SMOKE_VERBOSE && process.stderr.write(d));
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) return server; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error("next start did not become ready");
}

async function stopServer(server: ChildProcess) {
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

async function main() {
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL }, stdio: "pipe" });
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  execSync("npx tsx prisma/seed.ts", { env: { ...process.env, DATABASE_URL }, stdio: "pipe" });

  // ---- Phase 1: nothing configured. Everything that moves money must refuse.
  let server = await startServer({});
  const products = await (await fetch(`${BASE}/api/v1/products?market=NG`)).json();
  check("catalogue served from database", products.meta?.source === "database" && products.data?.length === 8, products.meta);
  const variantId: string = products.data[0].variantId;
  const order = { email: "smoke@example.com", market: "NG", shippingAddress: { recipient: "Smoke Test", phone: "+2348000000000", line1: "1 Test Street", city: "Lagos", countryCode: "NG" }, items: [{ variantId, quantity: 2 }] };
  const disabled = await post("/api/v1/checkout", order, { "Idempotency-Key": "smoke_disabled_0001" });
  check("checkout refuses when not enabled (503)", disabled.status === 503, await disabled.json());
  const hookNoKey = await post("/api/v1/webhooks/paystack", "{}", { "x-paystack-signature": "x" });
  check("webhook refuses without Paystack key (503, provider retries)", hookNoKey.status === 503);
  const quoteNoRule = await post("/api/v1/checkout/quotes", { market: "NG", countryCode: "NG", items: [{ variantId, quantity: 1 }] });
  check("no invented shipping price while delivery is unconfigured", quoteNoRule.status === 422 && (await quoteNoRule.json()).code === "SHIPPING_UNAVAILABLE");
  const cronNoSecret = await fetch(`${BASE}/api/internal/jobs/reconcile`, { headers: { authorization: "Bearer " } });
  check("cron endpoint refuses without CRON_SECRET", cronNoSecret.status === 503 || cronNoSecret.status === 401);
  await stopServer(server);

  // ---- Phase 2: configured against the fake Paystack. Walk the journey.
  await prisma.shippingRule.updateMany({ where: { countryCode: "NG" }, data: { enabled: true, flatRateMinor: BigInt(150000), providerCode: "SMOKE" } });
  const paystack = await new FakePaystack().start();
  server = await startServer({
    PAYSTACK_SECRET_KEY: paystack.secret, PAYSTACK_API_BASE_URL: paystack.baseUrl, CHECKOUT_ENABLED: "true",
    APP_BASE_URL: BASE, CRON_SECRET,
  });
  try {
    const home = await fetch(BASE);
    const html = await home.text();
    check("storefront renders and is labelled as a preview", home.ok && html.includes("STORE PREVIEW"));
    check("security headers present", Boolean(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'") && home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("strict-transport-security")));

    const quote = await (await post("/api/v1/checkout/quotes", { market: "NG", countryCode: "NG", items: [{ variantId, quantity: 2 }] })).json();
    check("quote priced server-side", quote.totalMinor === String(BigInt(products.data[0].priceMinor) * BigInt(2) + BigInt(150000)), quote);

    const created = await post("/api/v1/checkout", order, { "Idempotency-Key": "smoke_checkout_0001" });
    const checkout = await created.json();
    check("checkout creates pending order with Paystack URL", created.status === 201 && checkout.payment?.authorizationUrl?.startsWith("https://"), checkout);
    const replay = await (await post("/api/v1/checkout", order, { "Idempotency-Key": "smoke_checkout_0001" })).json();
    check("retried checkout returns the same order", replay.orderNumber === checkout.orderNumber);

    const reference: string = checkout.payment.reference;
    const before = await (await fetch(`${BASE}/checkout/complete?reference=${reference}`)).text();
    check("return page before payment does not claim success", !before.includes("Payment confirmed"));

    paystack.pay(reference);
    const forged = paystack.webhook("charge.success", { reference }, "sk_test_forged");
    check("forged webhook rejected", (await post("/api/v1/webhooks/paystack", forged.body, { "x-paystack-signature": forged.signature })).status === 401);
    const hook = paystack.chargeSuccessWebhook(reference);
    check("signed webhook accepted", (await post("/api/v1/webhooks/paystack", hook.body, { "x-paystack-signature": hook.signature })).status === 200);
    check("duplicate webhook acknowledged as duplicate", (await (await post("/api/v1/webhooks/paystack", hook.body, { "x-paystack-signature": hook.signature })).json()).duplicate === true);

    const after = await (await fetch(`${BASE}/checkout/complete?reference=${reference}`)).text();
    check("return page shows confirmed order", after.includes("Payment confirmed") && after.includes(checkout.orderNumber));
    const status = await (await post("/api/v1/payments/verify", { reference })).json();
    check("verify endpoint reports CONFIRMED", status.orderStatus === "CONFIRMED" && status.paymentStatus === "SUCCEEDED", status);

    const db = await prisma.order.findUniqueOrThrow({ where: { orderNumber: checkout.orderNumber }, include: { reservations: true } });
    const balance = await prisma.inventoryBalance.findFirstOrThrow({ where: { variantId } });
    check("stock committed exactly once", db.reservations.length === 1 && db.reservations[0].status === "COMMITTED" && balance.reservedQuantity === 2, { reservations: db.reservations.length, reserved: balance.reservedQuantity });

    check("cron rejects wrong token", (await fetch(`${BASE}/api/internal/jobs/reconcile`, { headers: { authorization: "Bearer nope" } })).status === 401);
    const job = await fetch(`${BASE}/api/internal/jobs/reconcile`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    check("cron runs with correct token", job.status === 200, await job.json());
  } finally {
    await stopServer(server);
    await paystack.stop();
    await prisma.$disconnect();
  }
  console.log(failures ? `\n${failures} smoke check(s) FAILED` : "\nAll smoke checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
