import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ConfigError, isSafeApiBaseUrl } from "@/lib/env";
import { getIntegration } from "@/lib/integrations/store";
import { ProviderRejectedError, ProviderUnavailableError, type GatewayPayment, type VerifiedPayment } from "@/lib/payments/types";

/**
 * Whop payments (https://docs.whop.com). A checkout configuration with an
 * inline one-time plan gives a hosted purchase URL; our payment reference rides
 * along in metadata, which Whop copies onto the resulting payment. Success is
 * only ever taken from GET /payments, never from the webhook body or redirect.
 */

export type WhopConfig = { apiKey: string; webhookSecret: string; companyId: string; apiBaseUrl: string; checkoutOrigin: string; environment: "sandbox" | "production" };

export async function getWhopConfig(purpose: "new" | "existing" = "existing"): Promise<WhopConfig> {
  const integration = await getIntegration("whop");
  if (!integration.configured) throw new ConfigError("PAYMENTS_NOT_CONFIGURED", "Whop is not configured.");
  if (purpose === "new" && !integration.enabled) throw new ConfigError("PAYMENTS_NOT_CONFIGURED", "Whop is switched off in Integrations.");
  const environment = integration.values.environment === "production" ? "production" : "sandbox";
  const apiBaseUrl = (process.env.WHOP_API_BASE_URL?.trim() || (environment === "production" ? "https://api.whop.com/api/v1" : "https://sandbox-api.whop.com/api/v1")).replace(/\/+$/, "");
  if (!isSafeApiBaseUrl(apiBaseUrl)) throw new ConfigError("PAYMENTS_MISCONFIGURED", "WHOP_API_BASE_URL must use https.");
  return {
    apiKey: integration.values.apiKey,
    webhookSecret: integration.values.webhookSecret,
    companyId: integration.values.companyId,
    apiBaseUrl,
    checkoutOrigin: environment === "production" ? "https://whop.com" : "https://sandbox.whop.com",
    environment,
  };
}

const TIMEOUT_MS = 15_000;

async function whopRequest<T>(config: WhopConfig, path: string, init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new ProviderUnavailableError(`Whop request failed: ${(error as Error).message}`);
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: { message?: string }; message?: string }) | null;
  if (response.status >= 500 || response.status === 429 || payload === null) throw new ProviderUnavailableError(`Whop returned HTTP ${response.status}.`);
  if (!response.ok) throw new ProviderRejectedError(payload.error?.message || payload.message || `Whop rejected the request (HTTP ${response.status}).`, response.status);
  return payload;
}

const toMajor = (minor: bigint) => Number(minor) / 100;
const toMinor = (major: unknown) => {
  if (typeof major !== "number" || !Number.isFinite(major) || major < 0) throw new ProviderUnavailableError("Whop returned an amount that is not a non-negative number.");
  return BigInt(Math.round(major * 100));
};

export async function initializeWhopCheckout(input: { reference: string; amountMinor: bigint; currency: string; callbackUrl: string; orderNumber: string }) {
  const config = await getWhopConfig("new");
  const redirect = new URL(input.callbackUrl);
  redirect.searchParams.set("reference", input.reference);
  const created = await whopRequest<{ id?: string; purchase_url?: string }>(config, "/checkout_configurations", {
    method: "POST",
    idempotencyKey: input.reference,
    body: {
      mode: "payment",
      plan: {
        company_id: config.companyId,
        currency: input.currency.toLowerCase(),
        initial_price: toMajor(input.amountMinor),
        plan_type: "one_time",
        title: `Order ${input.orderNumber}`,
        visibility: "hidden",
      },
      metadata: { reference: input.reference, order_number: input.orderNumber },
      redirect_url: redirect.toString(),
    },
  });
  if (!created.id || typeof created.purchase_url !== "string") throw new ProviderUnavailableError("Whop did not return a checkout URL.");
  const authorizationUrl = created.purchase_url.startsWith("/") ? `${config.checkoutOrigin}${created.purchase_url}` : created.purchase_url;
  if (!/^https?:\/\//.test(authorizationUrl)) throw new ProviderUnavailableError("Whop returned an unusable checkout URL.");
  return { authorizationUrl, session: { checkoutConfigurationId: created.id } };
}

type WhopPayment = {
  id: string;
  status?: string | null;
  substatus?: string | null;
  total?: number | null;
  subtotal?: number | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | null;
  paid_at?: string | null;
  checkout_configuration_id?: string | null;
  refunds?: { id?: string; status?: string; amount?: number; created_at?: string }[];
};

function checkoutIdOf(payment: GatewayPayment) {
  const meta = payment.metadataJson as { checkoutConfigurationId?: unknown } | null;
  return typeof meta?.checkoutConfigurationId === "string" ? meta.checkoutConfigurationId : null;
}

async function findWhopPayment(config: WhopConfig, payment: GatewayPayment): Promise<WhopPayment | null> {
  if (payment.providerTransactionId) {
    return whopRequest<WhopPayment>(config, `/payments/${encodeURIComponent(payment.providerTransactionId)}`, { method: "GET" });
  }
  const checkoutId = checkoutIdOf(payment);
  if (!checkoutId) return null;
  const query = new URLSearchParams({ account_id: config.companyId, first: "10" });
  query.append("checkout_configuration_ids", checkoutId);
  const list = await whopRequest<{ data?: WhopPayment[] }>(config, `/payments?${query}`, { method: "GET" });
  const candidates = list.data ?? [];
  return candidates.find((p) => p.status === "paid") ?? candidates[0] ?? null;
}

/** Server-to-server verification of a Whop payment, mapped onto our reference. */
export async function verifyWhopPayment(payment: GatewayPayment): Promise<VerifiedPayment> {
  const config = await getWhopConfig("existing");
  const found = await findWhopPayment(config, payment);
  if (!found) {
    return { reference: payment.providerReference, amountMinor: BigInt(0), currency: payment.currency, status: "pending", rawStatus: "no_payment_yet", providerTransactionId: null, paidAt: null };
  }
  const metaRef = found.metadata?.reference;
  if (typeof metaRef === "string" && metaRef !== payment.providerReference) {
    throw new ProviderUnavailableError("Whop payment metadata does not match this order.");
  }
  const substatus = found.substatus ?? "";
  const status = found.status === "paid" ? "success"
    : ["void", "uncollectible"].includes(found.status ?? "") || ["failed", "canceled"].includes(substatus) ? "failed"
    : "pending";
  const paidAt = found.paid_at ? new Date(found.paid_at) : null;
  return {
    reference: payment.providerReference,
    amountMinor: status === "success" ? toMinor(found.total ?? found.subtotal) : BigInt(0),
    currency: (found.currency ?? payment.currency).toUpperCase(),
    status,
    rawStatus: `${found.status ?? "unknown"}${substatus ? `/${substatus}` : ""}`,
    providerTransactionId: found.id,
    paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
  };
}

export async function refundWhopPayment(input: { payment: GatewayPayment; amountMinor: bigint }) {
  const config = await getWhopConfig("existing");
  let paymentId = input.payment.providerTransactionId;
  if (!paymentId) paymentId = (await findWhopPayment(config, input.payment))?.id ?? null;
  if (!paymentId) throw new ProviderRejectedError("No Whop payment found to refund.", 404);
  const result = await whopRequest<WhopPayment>(config, `/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: { partial_amount: toMajor(input.amountMinor) },
  });
  const newest = (result.refunds ?? [])[0];
  if (!newest?.id) throw new ProviderUnavailableError("Whop did not return the refund it created.");
  return { providerRef: newest.id, status: newest.status ?? "pending" };
}

/**
 * Standard Webhooks verification as Whop documents it: HMAC-SHA256 over
 * "{webhook-id}.{webhook-timestamp}.{raw body}", keyed with the signing secret
 * exactly as issued ("ws_…"); "whsec_" secrets use the spec's base64 key.
 * Timestamps more than five minutes from now are rejected (replay protection).
 */
export function verifyWhopWebhook(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, now = Date.now()) {
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false as const, reason: "missing headers" };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return { ok: false as const, reason: "timestamp outside tolerance" };
  const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest();
  const matches = headers.signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const received = Buffer.from(value, "base64");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
  return matches ? { ok: true as const } : { ok: false as const, reason: "signature mismatch" };
}

/** Proves the API key, company ID and payment-read permission with a read-only call. */
export async function testWhop() {
  const config = await getWhopConfig("existing");
  const query = new URLSearchParams({ account_id: config.companyId, first: "1" });
  await whopRequest<{ data?: unknown[] }>(config, `/payments?${query}`, { method: "GET" });
  return `Connected to ${config.companyId} (${config.environment}).`;
}
