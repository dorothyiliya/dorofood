import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPaystackRefund, initializePaystackTransaction, ProviderRejectedError, ProviderUnavailableError, verifyPaystackTransaction, verifyPaystackWebhook } from "@/lib/payments/paystack";
import { FakePaystack } from "../support/fake-paystack";

describe("verifyPaystackWebhook", () => {
  const secret = "sk_test_abc";
  const body = JSON.stringify({ event: "charge.success", data: { reference: "r" } });
  const sig = createHmac("sha512", secret).update(body).digest("hex");

  it("accepts the exact HMAC-SHA512 of the raw body", () => expect(verifyPaystackWebhook(body, sig, secret)).toBe(true));
  it("accepts upper-case hex", () => expect(verifyPaystackWebhook(body, sig.toUpperCase(), secret)).toBe(true));
  it("rejects a modified body", () => expect(verifyPaystackWebhook(body + " ", sig, secret)).toBe(false));
  it("rejects the wrong secret", () => expect(verifyPaystackWebhook(body, sig, "sk_test_other")).toBe(false));
  it("rejects truncated signatures without throwing", () => expect(verifyPaystackWebhook(body, sig.slice(0, 10), secret)).toBe(false));
});

describe("Paystack HTTP client", () => {
  const fake = new FakePaystack();
  beforeAll(async () => { await fake.start(); });
  afterAll(async () => { await fake.stop(); });
  beforeEach(() => {
    fake.reset();
    process.env.PAYSTACK_SECRET_KEY = fake.secret;
    process.env.PAYSTACK_API_BASE_URL = fake.baseUrl;
  });

  const init = (reference: string) => initializePaystackTransaction({ email: "a@example.com", amountMinor: BigInt(123456), currency: "NGN", reference, callbackUrl: "http://localhost:3000/checkout/complete", metadata: {} });

  it("sends integer minor units and returns the authorization URL", async () => {
    const session = await init("ref_1");
    expect(session.authorizationUrl).toMatch(/^https:\/\//);
    expect(fake.transactions.get("ref_1")).toMatchObject({ amount: 123456, currency: "NGN" });
  });

  it("treats an unpaid ('abandoned') transaction as pending, never failed or successful", async () => {
    await init("ref_2");
    expect(await verifyPaystackTransaction("ref_2")).toMatchObject({ status: "pending", rawStatus: "abandoned" });
    fake.pay("ref_2");
    expect(await verifyPaystackTransaction("ref_2")).toMatchObject({ status: "success", amountMinor: BigInt(123456), currency: "NGN" });
  });

  it("distinguishes 'outcome unknown' from 'definitely rejected'", async () => {
    fake.failNext("/transaction/verify/", "network");
    await expect(verifyPaystackTransaction("x")).rejects.toBeInstanceOf(ProviderUnavailableError);
    fake.failNext("/transaction/verify/", "server-error");
    await expect(verifyPaystackTransaction("x")).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(init("dup")).resolves.toBeTruthy();
    await expect(init("dup")).rejects.toBeInstanceOf(ProviderRejectedError);
  });

  it("refuses a refund larger than the payment", async () => {
    await init("ref_3");
    fake.pay("ref_3");
    await expect(createPaystackRefund({ reference: "ref_3", amountMinor: BigInt(999999), merchantNote: "x" })).rejects.toBeInstanceOf(ProviderRejectedError);
    await expect(createPaystackRefund({ reference: "ref_3", amountMinor: BigInt(1000), merchantNote: "x" })).resolves.toMatchObject({ status: "pending" });
  });
});
