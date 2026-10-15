import "server-only";

/**
 * Server-side configuration. Every getter re-reads process.env so a missing or
 * unsafe value is detected per request, and every commerce capability is
 * disabled unless it is explicitly and safely configured.
 */

export class ConfigError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type PaystackConfig = { secretKey: string; apiBaseUrl: string; mode: "test" | "live" };

export function getPaystackConfig(): PaystackConfig {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey) throw new ConfigError("PAYMENTS_NOT_CONFIGURED", "PAYSTACK_SECRET_KEY is not set.");

  const mode = secretKey.startsWith("sk_live_") ? "live" : secretKey.startsWith("sk_test_") ? "test" : null;
  if (!mode) throw new ConfigError("PAYMENTS_MISCONFIGURED", "PAYSTACK_SECRET_KEY must be an sk_test_ or sk_live_ key.");
  if (mode === "live" && process.env.PAYSTACK_ALLOW_LIVE_KEYS !== "true") {
    throw new ConfigError("PAYMENTS_LIVE_KEY_BLOCKED", "A live Paystack key is configured but PAYSTACK_ALLOW_LIVE_KEYS is not \"true\".");
  }

  const apiBaseUrl = (process.env.PAYSTACK_API_BASE_URL?.trim() || "https://api.paystack.co").replace(/\/+$/, "");
  if (mode === "live" && apiBaseUrl !== "https://api.paystack.co") {
    throw new ConfigError("PAYMENTS_MISCONFIGURED", "Live keys may only be sent to https://api.paystack.co.");
  }
  if (!/^https:\/\//.test(apiBaseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiBaseUrl)) {
    throw new ConfigError("PAYMENTS_MISCONFIGURED", "PAYSTACK_API_BASE_URL must use https.");
  }
  return { secretKey, apiBaseUrl, mode };
}

/** Webhook signatures are checked with the same secret key (Paystack has no separate webhook secret). */
export function getPaystackWebhookSecret(): string {
  return getPaystackConfig().secretKey;
}

export function assertCheckoutEnabled(): void {
  if (process.env.CHECKOUT_ENABLED !== "true") {
    throw new ConfigError("CHECKOUT_DISABLED", "Checkout is disabled. Set CHECKOUT_ENABLED=true only after launch sign-off.");
  }
  if (!process.env.DATABASE_URL) throw new ConfigError("DATABASE_NOT_CONFIGURED", "DATABASE_URL is not set.");
  getPaystackConfig();
  getAppBaseUrl();
}

/**
 * Public origin used for Paystack return URLs. Explicit APP_BASE_URL wins; on
 * Vercel, preview deployments fall back to their own branch/deployment URL.
 */
export function getAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL?.trim()
    || (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")
    || (process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : "")
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!raw) throw new ConfigError("APP_BASE_URL_NOT_CONFIGURED", "APP_BASE_URL is required to build payment callback URLs.");
  return raw.replace(/\/+$/, "");
}

export function getCronSecret(): string {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) throw new ConfigError("CRON_NOT_CONFIGURED", "CRON_SECRET must be set to at least 32 characters.");
  return secret;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

