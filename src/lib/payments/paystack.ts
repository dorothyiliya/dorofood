import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPaystackConfig } from "@/lib/env";

export function verifyPaystackWebhook(rawBody: string, signature: string, secret: string) {
  const expected = Buffer.from(createHmac("sha512", secret).update(rawBody).digest("hex"), "utf8");
  const received = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export type VerifiedPayment = {
  reference: string;
  amountMinor: bigint;
  currency: string;
  /** Normalised outcome. Only "success" may ever confirm an order. */
  status: "success" | "failed" | "pending";
  rawStatus: string;
  providerTransactionId: string | null;
  paidAt: Date | null;
};

/**
 * The provider call could not be completed or returned something unexpected.
 * The outcome is unknown, so callers must not treat it as a failed payment.
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

/** The provider definitively rejected the request (for example, a bad refund amount). */
export class ProviderRejectedError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "ProviderRejectedError";
  }
}

const TIMEOUT_MS = 15_000;

async function paystackRequest(path: string, init: { method: "GET" | "POST"; body?: unknown }) {
  const config = getPaystackConfig();
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
