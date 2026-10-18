import { createHmac, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decryptSecrets, encryptSecrets, hint } from "@/lib/integrations/crypto";
import { cleanDraft, draftProductDescription } from "@/lib/integrations/ai";
import { getEmailConfig, sendEmail } from "@/lib/integrations/email";
import { detectImageType, uploadProductPhoto } from "@/lib/integrations/storage";
import { render } from "@/lib/notifications";
import { verifyWhopWebhook } from "@/lib/payments/whop";
import { ProviderRejectedError } from "@/lib/payments/types";
import { FakeHttp, fakeResend } from "../support/fake-http";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("secret encryption", () => {
  beforeEach(() => { process.env.INTEGRATIONS_ENCRYPTION_KEY = "k".repeat(40); });

  it("round-trips and never contains the plaintext", () => {
    const cipher = encryptSecrets("paystack", { secretKey: "sk_test_supersecret123" });
    expect(cipher).not.toContain("supersecret");
    expect(decryptSecrets("paystack", cipher)).toEqual({ secretKey: "sk_test_supersecret123" });
  });
  it("is bound to its integration: a ciphertext moved to another row fails", () => {
    const cipher = encryptSecrets("paystack", { secretKey: "sk_test_x" });
    expect(() => decryptSecrets("whop", cipher)).toThrow();
  });
  it("detects tampering and a changed key", () => {
    const cipher = encryptSecrets("whop", { apiKey: "abc" });
    const parts = cipher.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecrets("whop", parts.join("."))).toThrow();
    process.env.INTEGRATIONS_ENCRYPTION_KEY = "z".repeat(40);
    expect(() => decryptSecrets("whop", cipher)).toThrow();
  });
  it("refuses to encrypt without a key", () => {
    delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
    expect(() => encryptSecrets("whop", { apiKey: "abc" })).toThrow(/INTEGRATIONS_ENCRYPTION_KEY/);
  });
  it("hints show only the last four characters", () => {
    expect(hint("sk_test_abcdef1234")).toBe("ends 1234");
    expect(hint("short")).toBe("saved");
  });
});

describe("Whop webhook signatures (Standard Webhooks)", () => {
  const body = JSON.stringify({ type: "payment.succeeded", data: { id: "pay_1" } });
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const sign = (key: Buffer, id = "msg_1", t = ts) => `v1,${createHmac("sha256", key).update(`${id}.${t}.${body}`).digest("base64")}`;

  it("accepts a ws_ secret used as raw bytes", () => {
    const secret = "ws_abc123";
    expect(verifyWhopWebhook(body, { id: "msg_1", timestamp: ts, signature: sign(Buffer.from(secret)) }, secret, now).ok).toBe(true);
  });
  it("accepts a whsec_ secret using its base64 key, and any matching signature in the list", () => {
    const raw = randomBytes(24);
    const secret = `whsec_${raw.toString("base64")}`;
    expect(verifyWhopWebhook(body, { id: "msg_1", timestamp: ts, signature: `v1,bm9wZQ== ${sign(raw)}` }, secret, now).ok).toBe(true);
  });
  it("rejects a replayed delivery outside five minutes, and a different message id", () => {
    const secret = "ws_abc123";
    const old = String(Math.floor(now / 1000) - 301);
    expect(verifyWhopWebhook(body, { id: "msg_1", timestamp: old, signature: sign(Buffer.from(secret), "msg_1", old) }, secret, now)).toMatchObject({ ok: false, reason: "timestamp outside tolerance" });
    expect(verifyWhopWebhook(body, { id: "msg_2", timestamp: ts, signature: sign(Buffer.from(secret)) }, secret, now).ok).toBe(false);
    expect(verifyWhopWebhook(body, { id: null, timestamp: ts, signature: sign(Buffer.from(secret)) }, secret, now).ok).toBe(false);
  });
});

describe("AI drafts", () => {
  const nim = new FakeHttp();
  beforeAll(async () => { await nim.start(); });
  afterAll(async () => { await nim.stop(); });
  beforeEach(() => {
    nim.reset();
    process.env.NVIDIA_API_KEY = "nvapi-test-key-0000";
    process.env.NVIDIA_BASE_URL = nim.baseUrl;
  });

  it("strips reasoning, markup and preambles from model output", () => {
    expect(cleanDraft("<think>plan</think>Here's a description:\n**Crunchy** plantain <b>chips</b>, salted.")).toBe("Crunchy plantain chips, salted.");
  });

  it("sends only the facts given, with the key as a bearer token, and returns clean text", async () => {
    nim.next({ body: { choices: [{ message: { content: "<think>x</think>\"Golden, crunchy plantain chips with a gentle salt finish, made in Nigeria.\"" } }] } });
    const text = await draftProductDescription({ name: "Plantain Chips", originCountry: "NG", packSizes: ["150 g"], notes: "lightly salted" });
    expect(text).toBe("Golden, crunchy plantain chips with a gentle salt finish, made in Nigeria.");
    const req = nim.requests[0];
    expect(req.path).toBe("/chat/completions");
    expect(req.headers.authorization).toBe("Bearer nvapi-test-key-0000");
    const sent = req.json as { model: string; messages: { role: string; content: string }[] };
    expect(sent.model).toBe("meta/llama-3.3-70b-instruct");
    expect(sent.messages[0].content).toMatch(/never invent/);
    expect(sent.messages[1].content).toContain("Pack sizes: 150 g");
  });

  it("reports a rejected key as a rejection", async () => {
    nim.next({ status: 401, body: { detail: "Unauthorized" } });
    await expect(draftProductDescription({ name: "Tea" })).rejects.toBeInstanceOf(ProviderRejectedError);
  });

  it("is unavailable when not configured", async () => {
    delete process.env.NVIDIA_API_KEY;
    await expect(draftProductDescription({ name: "Tea" })).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });
});

describe("email", () => {
  const resend = fakeResend();
  beforeAll(async () => { await resend.start(); });
  afterAll(async () => { await resend.stop(); });
  beforeEach(() => {
    resend.reset();
    process.env.RESEND_API_KEY = "re_test_123456789";
    process.env.EMAIL_FROM = "Dorocity Foods <orders@example.com>";
    process.env.RESEND_API_BASE_URL = resend.baseUrl;
  });

  it("is skipped, not failed, when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await getEmailConfig()).toBeNull();
  });

  it("sends with an idempotency key", async () => {
    const config = (await getEmailConfig())!;
    const sent = await sendEmail(config, { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "notification-1" });
    expect(sent.id).toMatch(/^email_/);
    expect(resend.requests[0].headers["idempotency-key"]).toBe("notification-1");
    expect(resend.requests[0].json).toMatchObject({ from: "Dorocity Foods <orders@example.com>", to: ["a@example.com"] });
  });

  it("templates escape customer-controlled text and only link https tracking URLs", () => {
    const base = { orderNumber: "DF-1", currency: "NGN", recipient: "<script>alert(1)</script> Ada", lines: [{ name: "Tea <b>", packSize: "1", quantity: 1, totalMinor: "100000" }], subtotalMinor: "100000", shippingMinor: "0", totalMinor: "100000" };
    const confirmed = render({ kind: "ORDER_CONFIRMED", ...base });
    expect(confirmed.html).not.toContain("<script>");
    expect(confirmed.html).toContain("Tea &lt;b&gt;");
    const dispatched = render({ kind: "ORDER_DISPATCHED", ...base, trackingNumber: "T1", trackingUrl: "javascript:alert(1)" });
    expect(dispatched.html).not.toContain("javascript:");
  });
});

describe("photo storage", () => {
  const s3 = new FakeHttp(() => ({ status: 200, body: {} }));
  beforeAll(async () => { await s3.start(); });
  afterAll(async () => { await s3.stop(); });
  beforeEach(() => {
    s3.reset();
    Object.assign(process.env, { S3_ENDPOINT: s3.baseUrl, S3_BUCKET: "photos", S3_PUBLIC_BASE_URL: "https://images.example.com", S3_ACCESS_KEY_ID: "AKIDTEST", S3_SECRET_ACCESS_KEY: "secret-test-key" });
  });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  it("recognises images by their bytes, not their name", () => {
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectImageType(png)).toBe("image/png");
    expect(detectImageType(new Uint8Array(Buffer.from("RIFF0000WEBPVP8 ")))).toBe("image/webp");
    expect(detectImageType(new Uint8Array(Buffer.from("<svg onload=alert(1)>")))).toBeNull();
  });

  it("uploads with a SigV4 signature to {endpoint}/{bucket}/products/... and returns the public URL", async () => {
    const url = await uploadProductPhoto(new File([png], "evil.svg", { type: "image/svg+xml" }));
    expect(url).toMatch(/^https:\/\/images\.example\.com\/products\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    const req = s3.requests[0];
    expect(req.method).toBe("PUT");
    expect(req.path).toMatch(/^\/photos\/products\//);
    expect(req.headers["content-type"]).toBe("image/png");
    expect(String(req.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\//);
    expect(String(req.headers.authorization)).not.toContain("secret-test-key");
  });

  it("rejects non-images and oversized files before contacting storage", async () => {
    await expect(uploadProductPhoto(new File(["<svg/>"], "a.png"))).rejects.toMatchObject({ code: "PHOTO_TYPE" });
    await expect(uploadProductPhoto(new File([Buffer.alloc(4 * 1024 * 1024 + 1)], "big.jpg"))).rejects.toMatchObject({ code: "PHOTO_TOO_LARGE" });
    expect(s3.requests).toHaveLength(0);
  });

  it("surfaces a storage refusal with its error code", async () => {
    s3.next({ status: 403, raw: "<Error><Code>AccessDenied</Code></Error>" });
    await expect(uploadProductPhoto(new File([png], "a.png"))).rejects.toThrow(/AccessDenied/);
  });
});
