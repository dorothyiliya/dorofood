import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ConfigError, isSafeApiBaseUrl } from "@/lib/env";
import { getIntegration } from "@/lib/integrations/store";
import { ProviderRejectedError, ProviderUnavailableError, type VerifiedPayment } from "@/lib/payments/types";

export { ProviderRejectedError, ProviderUnavailableError, type VerifiedPayment } from "@/lib/payments/types";

export function verifyPaystackWebhook(rawBody: string, signature: string, secret: string) {
  const expected = Buffer.from(createHmac("sha512", secret).update(rawBody).digest("hex"), "utf8");
  const received = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export type PaystackConfig = { secretKey: string; apiBaseUrl: string; mode: "test" | "live" };

/** Pure validation of Paystack settings: no live key without an explicit opt-in, and only to Paystack's own host. */
export function validatePaystackConfig(input: { secretKey?: string; allowLive?: boolean; apiBaseUrl?: string }): PaystackConfig {
  const secretKey = input.secretKey?.trim();
  if (!secretKey) throw new ConfigError("PAYMENTS_NOT_CONFIGURED", "Paystack is not configured (no secret key).");
  const mode = secretKey.startsWith("sk_live_") ? "live" : secretKey.startsWith("sk_test_") ? "test" : null;
  if (!mode) throw new ConfigError("PAYMENTS_MISCONFIGURED", "The Paystack secret key must start with sk_test_ or sk_live_.");
  if (mode === "live" && !input.allowLive) {
    throw new ConfigError("PAYMENTS_LIVE_KEY_BLOCKED", "A live Paystack key is configured but live keys are not allowed (Integrations, or PAYSTACK_ALLOW_LIVE_KEYS).");
  }
  const apiBaseUrl = (input.apiBaseUrl?.trim() || "https://api.paystack.co").replace(/\/+$/, "");
  if (mode === "live" && apiBaseUrl !== "https://api.paystack.co") {
    throw new ConfigError("PAYMENTS_MISCONFIGURED", "Live keys may only be sent to https://api.paystack.co.");
  }
  if (!isSafeApiBaseUrl(apiBaseUrl)) throw new ConfigError("PAYMENTS_MISCONFIGURED", "PAYSTACK_API_BASE_URL must use https.");
  return { secretKey, apiBaseUrl, mode };
}

/**
 * Paystack settings from Integrations (environment variables win).
 * `purpose: "new"` also requires the integration to be switched on; settling
 * payments that already exist only needs credentials.
 */
export async function getPaystackConfig(purpose: "new" | "existing" = "existing"): Promise<PaystackConfig> {
  const integration = await getIntegration("paystack");
  if (purpose === "new" && integration.configured && !integration.enabled) {
    throw new ConfigError("PAYMENTS_NOT_CONFIGURED", "Paystack is switched off in Integrations.");
  }
  return validatePaystackConfig({
    secretKey: integration.values.secretKey,
    allowLive: integration.values.allowLive === "true",
    apiBaseUrl: process.env.PAYSTACK_API_BASE_URL,
  });
}

/** Webhook signatures are checked with the secret key (Paystack has no separate webhook secret). */
export async function getPaystackWebhookSecret(): Promise<string> {
  return (await getPaystackConfig("existing")).secretKey;
}

const TIMEOUT_MS = 15_000;

async function paystackRequest(path: string, init: { method: "GET" | "POST"; body?: unknown }) {
  const config = await getPaystackConfig();
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new ProviderUnavailableError(`Paystack request failed: ${(error as Error).message}`);
  }

  const payload = (await response.json().catch(() => null)) as { status?: boolean; message?: string; data?: unknown } | null;
  if (response.status >= 500 || response.status === 429 || payload === null) {
    throw new ProviderUnavailableError(`Paystack returned HTTP ${response.status}.`);
  }
  if (!response.ok || payload.status !== true) {
    throw new ProviderRejectedError(payload.message || `Paystack rejected the request (HTTP ${response.status}).`, response.status);
  }
  return payload.data as Record<string, unknown>;
}

function toMinor(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new ProviderUnavailableError("Paystack returned an amount that is not a non-negative integer.");
}

export async function initializePaystackTransaction(input: {
  email: string;
  amountMinor: bigint;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}): Promise<{ authorizationUrl: string; accessCode: string | null }> {
  const data = await paystackRequest("/transaction/initialize", {
    method: "POST",
    body: {
      email: input.email,
      amount: input.amountMinor.toString(),
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    },
  });
  const authorizationUrl = data?.authorization_url;
  if (typeof authorizationUrl !== "string" || !/^https?:\/\//.test(authorizationUrl)) {
    throw new ProviderUnavailableError("Paystack did not return an authorization URL.");
  }
  return { authorizationUrl, accessCode: typeof data.access_code === "string" ? data.access_code : null };
}

/**
 * Server-to-server verification. This, not the browser redirect and not the
 * webhook body, is the only source of truth for whether money was received.
 */
export async function verifyPaystackTransaction(reference: string): Promise<VerifiedPayment> {
  const data = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });
  if (data?.reference !== reference) throw new ProviderUnavailableError("Paystack verification returned a different reference.");
  const rawStatus = String(data.status ?? "");
  // "abandoned" is what Paystack reports for an initialised transaction the
  // customer has not completed yet, so it must not be treated as final.
  const status = rawStatus === "success" ? "success" : ["failed", "reversed"].includes(rawStatus) ? "failed" : "pending";
  const paidAt = typeof data.paid_at === "string" ? new Date(data.paid_at) : null;
  return {
    reference,
    amountMinor: toMinor(data.amount),
    currency: String(data.currency ?? ""),
    status,
    rawStatus,
    providerTransactionId: data.id == null ? null : String(data.id),
    paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
  };
}

export async function createPaystackRefund(input: { reference: string; amountMinor: bigint; merchantNote: string }) {
  const data = await paystackRequest("/refund", {
    method: "POST",
    body: { transaction: input.reference, amount: input.amountMinor.toString(), merchant_note: input.merchantNote },
  });
  const id = data?.id;
  if (id == null) throw new ProviderUnavailableError("Paystack did not return a refund id.");
  return { providerRef: String(id), status: String(data.status ?? "pending") };
}

/** Proves the key works with a read-only call. */
export async function testPaystack() {
  const config = await getPaystackConfig("existing");
  await paystackRequest("/balance", { method: "GET" });
  return `Connected with a ${config.mode === "live" ? "LIVE" : "test"} key.`;
}
