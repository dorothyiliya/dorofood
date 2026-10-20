import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requestRefund } from "@/lib/commerce/refunds";
import { POST as whopWebhookRoute } from "@/app/api/v1/webhooks/whop/route";
import { api, checkoutBody, inventoryInvariantViolations, orderByNumber, prisma, seedFixture, setupIntegrationHarness } from "../support/harness";
import { FakeWhop } from "../support/fake-whop";

setupIntegrationHarness();
const whop = new FakeWhop();

function useWhopEnv() {
  process.env.WHOP_API_KEY = whop.apiKey;
  process.env.WHOP_WEBHOOK_SECRET = whop.webhookSecret;
  process.env.WHOP_COMPANY_ID = whop.companyId;
  process.env.WHOP_API_BASE_URL = whop.baseUrl;
}

beforeAll(async () => { await whop.start(); });
afterAll(async () => {
  await whop.stop();
  for (const k of ["WHOP_API_KEY", "WHOP_WEBHOOK_SECRET", "WHOP_COMPANY_ID", "WHOP_API_BASE_URL"]) delete process.env[k];
});
beforeEach(() => { whop.reset(); useWhopEnv(); });

async function deliver(delivery: { body: string; headers: { id: string; timestamp: string; signature: string } }) {
  const res = await whopWebhookRoute(new Request("http://localhost/api/v1/webhooks/whop", {
    method: "POST",
    headers: { "Content-Type": "application/json", "webhook-id": delivery.headers.id, "webhook-timestamp": delivery.headers.timestamp, "webhook-signature": delivery.headers.signature },
    body: delivery.body,
  }));
  return { status: res.status, body: await res.json() };
}

/** Tea to the UK: GBP 9.00 + GBP 12.00 delivery, paid through Whop. */
async function ukCheckout() {
  const f = await seedFixture();
  await prisma.market.update({ where: { code: "GB" }, data: { paymentProvider: "whop" } });
  const res = await api.checkout(checkoutBody([{ variantId: f.tea, quantity: 1 }], { market: "GB", countryCode: "GB" }));
  expect(res.status).toBe(201);
  return { f, orderNumber: res.body.orderNumber as string, reference: res.body.payment.reference as string, url: res.body.payment.authorizationUrl as string };
}

function paymentSucceeded(payment: { id: string; checkout_configuration_id: string; metadata: Record<string, string>; total: number }, opts?: Parameters<FakeWhop["webhook"]>[2]) {
  return whop.webhook("payment.succeeded", { id: payment.id, status: "paid", total: payment.total, checkout_configuration_id: payment.checkout_configuration_id, metadata: payment.metadata }, opts);
}

describe("Whop checkout", () => {
  it("creates a hidden one-time plan for the exact order total and sends the customer to Whop", async () => {
    const { reference, url } = await ukCheckout();
    const checkout = whop.checkoutFor(reference)!;
    expect(checkout.plan).toMatchObject({ initial_price: 21, currency: "gbp", plan_type: "one_time", company_id: whop.companyId });
    expect(url).toBe(`https://sandbox.whop.com/checkout/${checkout.id}/`);
    expect(checkout.redirect_url).toContain(`reference=${reference}`);
    const payment = await prisma.paymentTransaction.findUniqueOrThrow({ where: { providerReference: reference } });
    expect(payment).toMatchObject({ provider: "whop", amountMinor: BigInt(2100), currency: "GBP" });
    expect(payment.metadataJson).toMatchObject({ checkoutConfigurationId: checkout.id });
  });

  it("Nigeria on Whop charges the exact naira total and confirms through Whop", async () => {
    const f = await seedFixture();
    await prisma.market.update({ where: { code: "NG" }, data: { paymentProvider: "whop" } });
    const res = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]));
    expect(res.status).toBe(201);
    const reference = res.body.payment.reference as string;
    expect(whop.checkoutFor(reference)!.plan).toMatchObject({ initial_price: 3350, currency: "ngn" }); // N1,850 + N1,500 delivery
    const paid = whop.pay(reference);
    expect((await deliver(paymentSucceeded(paid))).status).toBe(200);
    const order = await orderByNumber(res.body.orderNumber);
    expect(order).toMatchObject({ status: "CONFIRMED", currency: "NGN" });
    expect(order.payments[0]).toMatchObject({ provider: "whop", receivedAmountMinor: BigInt(335000), receivedCurrency: "NGN" });
  });

  it("a market switched to an unconfigured Whop fails closed before any stock is held", async () => {
    delete process.env.WHOP_API_KEY;
    const f = await seedFixture();
    await prisma.market.update({ where: { code: "GB" }, data: { paymentProvider: "whop" } });
    const res = await api.checkout(checkoutBody([{ variantId: f.tea, quantity: 1 }], { market: "GB", countryCode: "GB" }));
    expect(res.status).toBe(503);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.inventoryReservation.count()).toBe(0);
  });

  it("payment.succeeded confirms once; retries of the same delivery are no-ops", async () => {
    const { orderNumber, reference } = await ukCheckout();
    const paid = whop.pay(reference);
    const delivery = paymentSucceeded(paid);

    const first = await Promise.all([deliver(delivery), deliver(delivery), deliver(delivery)]);
    expect(first.every((r) => r.status === 200)).toBe(true);
    expect((await deliver(delivery)).body).toMatchObject({ duplicate: true });

    const order = await orderByNumber(orderNumber);
    expect(order.status).toBe("CONFIRMED");
    expect(order.payments[0]).toMatchObject({ status: "SUCCEEDED", providerTransactionId: paid.id, receivedAmountMinor: BigInt(2100) });
    expect(await prisma.paymentEvent.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "PAYMENT_CONFIRMED" } })).toBe(1);
    expect(await inventoryInvariantViolations()).toEqual([]);
  });

  it("rejects forged, tampered, wrong-secret and stale deliveries without storing them", async () => {
    const { orderNumber, reference } = await ukCheckout();
    const paid = whop.pay(reference);
    const genuine = paymentSucceeded(paid);

    expect((await deliver({ ...genuine, headers: { ...genuine.headers, signature: "v1,AAAA" } })).status).toBe(401);
    expect((await deliver({ ...genuine, body: genuine.body.replace(/}$/, ',"x":1}') })).status).toBe(401);
    expect((await deliver(paymentSucceeded(paid, { secret: "ws_attacker" }))).status).toBe(401);
    expect((await deliver(paymentSucceeded(paid, { timestamp: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(401);
    expect(await prisma.paymentEvent.count()).toBe(0);
    expect((await orderByNumber(orderNumber)).status).toBe("PENDING_PAYMENT");
  });

  it("a signed success claim for a payment Whop has not taken does not confirm", async () => {
    const { orderNumber, reference } = await ukCheckout();
    const checkout = whop.checkoutFor(reference)!;
    const res = await deliver(whop.webhook("payment.succeeded", { id: "pay_forged", status: "paid", total: 21, checkout_configuration_id: checkout.id, metadata: { reference } }));
    expect(res.status).toBe(500); // Whop has no such payment: verification fails, the event is kept for retry
    expect((await orderByNumber(orderNumber)).status).toBe("PENDING_PAYMENT");
  });

  it("an underpayment goes to review instead of confirming", async () => {
    const { orderNumber, reference } = await ukCheckout();
    const paid = whop.pay(reference, { total: 1 });
    await deliver(paymentSucceeded(paid));
    expect((await orderByNumber(orderNumber)).status).toBe("PAYMENT_REVIEW");
  });

  it("a lost webhook is recovered by reconciliation through the checkout configuration", async () => {
    const { orderNumber, reference } = await ukCheckout();
    whop.pay(reference);
    await prisma.paymentTransaction.updateMany({ data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    const job = await api.reconcile();
    expect(job.status).toBe(200);
    expect((await orderByNumber(orderNumber)).status).toBe("CONFIRMED");
  });

  it("the customer's return page verifies with Whop rather than trusting the redirect", async () => {
    const { orderNumber, reference } = await ukCheckout();
    expect((await api.verify(reference)).body).toMatchObject({ orderStatus: "PENDING_PAYMENT" });
    whop.pay(reference);
    await api.verify(reference);
    expect((await orderByNumber(orderNumber)).status).toBe("CONFIRMED");
  });
});

describe("Whop refunds", () => {
  async function confirmed() {
    const c = await ukCheckout();
    const paid = whop.pay(c.reference);
    await deliver(paymentSucceeded(paid));
    return { ...c, order: await orderByNumber(c.orderNumber), paid };
  }

  it("refunds through Whop in major units and completes on refund.succeeded", async () => {
    const { order, paid } = await confirmed();
    const refund = await requestRefund({ orderId: order.id, reason: "Customer cancelled", actorId: "staff-1", idempotencyKey: "w-1" });
    expect(refund).toMatchObject({ status: "REFUND_PENDING", providerCallState: "SENT" });
    expect(refund.providerRef).toMatch(/^rf_/);
    expect(whop.calls.find((c) => c.path.endsWith("/refund"))?.body).toEqual({ partial_amount: 21 });

    const delivery = whop.webhook("refund.succeeded", { id: refund.providerRef, status: "succeeded", amount: 21, payment: { id: paid.id } });
    expect((await deliver(delivery)).status).toBe(200);
    expect((await deliver(delivery)).body).toMatchObject({ duplicate: true });
    const after = await orderByNumber(order.orderNumber);
    expect(after.status).toBe("REFUNDED");
    expect(after.payments[0].status).toBe("REFUNDED");
  });

  it("a refund whose response was lost is matched by payment and amount when Whop reports it", async () => {
    const { order, paid } = await confirmed();
    const refund = await requestRefund({ orderId: order.id, amountMinor: BigInt(500), reason: "Damaged", actorId: "staff-1", idempotencyKey: "w-2" });
    await prisma.refund.update({ where: { id: refund.id }, data: { providerRef: null, providerCallState: "UNKNOWN" } });

    await deliver(whop.webhook("refund.succeeded", { id: "rf_from_whop", status: "succeeded", amount: 5, payment_id: paid.id }));
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ status: "REFUNDED", providerRef: "rf_from_whop" });
  });

  it("a refund Whop rejects is recorded as failed and not retried", async () => {
    const { order } = await confirmed();
    whop.failNext("/payments/", "reject");
    const refund = await requestRefund({ orderId: order.id, reason: "Cancelled", actorId: "staff-1", idempotencyKey: "w-3" });
    expect(refund.status).toBe("FAILED");
    await api.reconcile();
    expect(whop.calls.filter((c) => c.path.endsWith("/refund"))).toHaveLength(1);
  });
});
