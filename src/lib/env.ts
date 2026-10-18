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

/** Deployment-level switches. Payment gateway credentials are checked per market at checkout. */
export function assertCheckoutEnabled(): void {
  if (process.env.CHECKOUT_ENABLED !== "true") {
    throw new ConfigError("CHECKOUT_DISABLED", "Checkout is disabled. Set CHECKOUT_ENABLED=true only after launch sign-off.");
  }
  if (!process.env.DATABASE_URL) throw new ConfigError("DATABASE_NOT_CONFIGURED", "DATABASE_URL is not set.");
  getAppBaseUrl();
}

/** Only https endpoints, except loopback addresses used by local test doubles. */
export function isSafeApiBaseUrl(url: string) {
  return /^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/.*)?$/.test(url);
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

