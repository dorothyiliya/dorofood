import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getIntegration, saveIntegration } from "@/lib/integrations/store";
import { testIntegration } from "@/lib/integrations/testing";
import { saveMarket } from "@/lib/admin/markets";
import { requestRefund } from "@/lib/commerce/refunds";
import { api, checkoutBody, orderByNumber, prisma, seedFixture, setupIntegrationHarness } from "../support/harness";
import { FakeWhop } from "../support/fake-whop";
import { fakeResend } from "../support/fake-http";

const paystack = setupIntegrationHarness();
const resend = fakeResend();
const whop = new FakeWhop();

beforeAll(async () => { await Promise.all([resend.start(), whop.start()]); });
afterAll(async () => {
  await Promise.all([resend.stop(), whop.stop()]);
  for (const k of ["INTEGRATIONS_ENCRYPTION_KEY", "RESEND_API_KEY", "EMAIL_FROM", "RESEND_API_BASE_URL", "WHOP_API_KEY", "WHOP_WEBHOOK_SECRET", "WHOP_COMPANY_ID", "WHOP_API_BASE_URL"]) delete process.env[k];
});
beforeEach(() => {
  resend.reset();
  whop.reset();
  process.env.INTEGRATIONS_ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef";
  process.env.RESEND_API_BASE_URL = resend.baseUrl;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

function useResendEnv() {
  process.env.RESEND_API_KEY = "re_test_123456789";
  process.env.EMAIL_FROM = "Dorocity Foods <orders@example.com>";
}

async function paidOrder(variantId: string) {
  const res = await api.checkout(checkoutBody([{ variantId, quantity: 1 }]));
  expect(res.status).toBe(201);
  paystack.pay(res.body.payment.reference);
  const delivery = paystack.chargeSuccessWebhook(res.body.payment.reference);
  await api.webhook(delivery);
  return { orderNumber: res.body.orderNumber as string, reference: res.body.payment.reference as string, delivery };
}

describe("integration settings", () => {
  it("encrypts secrets at rest, keeps them when left blank, and clears them on request", async () => {
    await saveIntegration("nvidia", { enabled: true, settings: { model: "meta/llama-3.1-8b-instruct" }, secrets: { apiKey: "nvapi-secret-abcdef-9876" } }, "staff-1");
    const [raw] = await prisma.$queryRaw<{ row: string }[]>`SELECT row_to_json(i)::text AS row FROM "Integration" i WHERE key = 'nvidia'`;
    expect(raw.row).not.toContain("nvapi-secret");
    let state = await getIntegration("nvidia");
    expect(state).toMatchObject({ active: true, hints: { apiKey: "ends 9876" }, values: { apiKey: "nvapi-secret-abcdef-9876", model: "meta/llama-3.1-8b-instruct" } });

    await saveIntegration("nvidia", { enabled: true, settings: {}, secrets: { apiKey: "" } }, "staff-1");
    state = await getIntegration("nvidia");
    expect(state.values).toMatchObject({ apiKey: "nvapi-secret-abcdef-9876", model: "meta/llama-3.1-8b-instruct" });

    await saveIntegration("nvidia", { enabled: true, settings: {}, secrets: {}, clear: ["apiKey"] }, "staff-1");
    expect(await getIntegration("nvidia")).toMatchObject({ configured: false, active: false });

    const audits = await prisma.auditEvent.findMany({ where: { entityType: "Integration" } });
    expect(JSON.stringify(audits)).not.toContain("nvapi-secret");
  });

  it("refuses to store a secret without an encryption key", async () => {
    delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
    await expect(saveIntegration("resend", { enabled: true, settings: {}, secrets: { apiKey: "re_x_123456789" } }, "staff-1")).rejects.toMatchObject({ code: "ENCRYPTION_KEY_MISSING" });
  });

  it("an environment variable overrides the admin, and testing an env-only integration does not switch it off", async () => {
    useResendEnv();
    await saveIntegration("resend", { enabled: true, settings: { from: "Admin <admin@example.com>" }, secrets: {} }, "staff-1");
    expect((await getIntegration("resend")).values.from).toBe("Dorocity Foods <orders@example.com>");
    await prisma.integration.deleteMany();

    const result = await testIntegration("resend", { id: "staff-1", email: "owner@example.com" });
    expect(result.ok).toBe(true);
    expect(resend.requests[0].json).toMatchObject({ to: ["owner@example.com"] });
    expect(await getIntegration("resend")).toMatchObject({ active: true, lastTest: { ok: true } });
  });

  it("Paystack can be configured entirely from the admin, and switching it off stops new payments only", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const f = await seedFixture();
    expect((await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]))).status).toBe(503);

    await saveIntegration("paystack", { enabled: true, settings: {}, secrets: { secretKey: paystack.secret } }, "staff-1");
    const { orderNumber } = await paidOrder(f.crisps);
    expect((await orderByNumber(orderNumber)).status).toBe("CONFIRMED");

    const pending = await api.checkout(checkoutBody([{ variantId: f.tea, quantity: 1 }]));
    await saveIntegration("paystack", { enabled: false, settings: {}, secrets: {} }, "staff-1");
    expect((await api.checkout(checkoutBody([{ variantId: f.tea, quantity: 1 }]))).status).toBe(503);
    // A customer who already paid is still confirmed.
    paystack.pay(pending.body.payment.reference);
    expect((await api.webhook(paystack.chargeSuccessWebhook(pending.body.payment.reference))).status).toBe(200);
    expect((await orderByNumber(pending.body.orderNumber)).status).toBe("CONFIRMED");
  });

  it("the Whop connection test calls Whop read-only and records the result", async () => {
    Object.assign(process.env, { WHOP_API_KEY: whop.apiKey, WHOP_WEBHOOK_SECRET: whop.webhookSecret, WHOP_COMPANY_ID: whop.companyId, WHOP_API_BASE_URL: whop.baseUrl });
    expect(await testIntegration("whop", { id: "staff-1", email: "o@example.com" })).toMatchObject({ ok: true });
    expect(whop.calls.every((c) => c.method === "GET")).toBe(true);
    process.env.WHOP_API_KEY = "apik_wrong";
    expect(await testIntegration("whop", { id: "staff-1", email: "o@example.com" })).toMatchObject({ ok: false, message: expect.stringMatching(/^Rejected/) });
    for (const k of ["WHOP_API_KEY", "WHOP_WEBHOOK_SECRET", "WHOP_COMPANY_ID", "WHOP_API_BASE_URL"]) delete process.env[k];
  });

  it("an active market cannot be switched to a gateway that is not ready", async () => {
    await seedFixture();
    const gb = await prisma.market.findUniqueOrThrow({ where: { code: "GB" } });
    const input = { code: "GB", name: "United Kingdom", countryCode: "GB", currency: "GBP" as const, paymentProvider: "whop" as const };
    await expect(saveMarket(gb.id, { ...input, status: "ACTIVE" }, "staff-1")).rejects.toMatchObject({ code: "GATEWAY_NOT_READY" });
    await saveMarket(gb.id, { ...input, status: "PAUSED" }, "staff-1");
    expect((await prisma.market.findUniqueOrThrow({ where: { id: gb.id } })).paymentProvider).toBe("whop");
  });
});

describe("customer emails", () => {
  it("a confirmed order sends one confirmation email, however many times the webhook arrives", async () => {
    useResendEnv();
    const f = await seedFixture();
    const { orderNumber, delivery } = await paidOrder(f.crisps);
    await api.webhook(delivery);
    await api.verify((await orderByNumber(orderNumber)).payments[0].providerReference);

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "ORDER_CONFIRMED", status: "SENT", toEmail: "customer@example.com", subject: `Order ${orderNumber} confirmed` });
    expect(resend.requests).toHaveLength(1);
    expect(resend.requests[0].headers["idempotency-key"]).toBe(`notification-${rows[0].id}`);
  });

  it("is recorded as skipped when email is not set up, without affecting the order", async () => {
    const f = await seedFixture();
    const { orderNumber } = await paidOrder(f.crisps);
    expect((await orderByNumber(orderNumber)).status).toBe("CONFIRMED");
    expect(await prisma.notification.findFirstOrThrow()).toMatchObject({ status: "SKIPPED" });
    expect(resend.requests).toHaveLength(0);
  });

  it("an email that could not be sent is retried by the scheduled job", async () => {
    useResendEnv();
    const f = await seedFixture();
    resend.next({ status: 503, body: { message: "down" } });
    await paidOrder(f.crisps);
    expect(await prisma.notification.findFirstOrThrow()).toMatchObject({ status: "PENDING", attempts: 1 });

    await prisma.notification.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const job = await api.reconcile();
    expect(job.body.emails).toMatchObject({ examined: 1, outcomes: { SENT: 1 } });
    expect(await prisma.notification.findFirstOrThrow()).toMatchObject({ status: "SENT" });
  });

  it("a completed refund emails the customer", async () => {
    useResendEnv();
    const f = await seedFixture();
    const { orderNumber } = await paidOrder(f.crisps);
    const order = await orderByNumber(orderNumber);
    const refund = await requestRefund({ orderId: order.id, reason: "Cancelled", actorId: "staff-1", idempotencyKey: "e-1" });
    await api.webhook(paystack.webhook("refund.processed", { id: Number(refund.providerRef), amount: 335000, currency: "NGN", status: "processed", transaction_reference: order.payments[0].providerReference }));
    const email = await prisma.notification.findFirstOrThrow({ where: { kind: "REFUND_PROCESSED" } });
    expect(email).toMatchObject({ status: "SENT", subject: expect.stringContaining(orderNumber) });
  });
});
