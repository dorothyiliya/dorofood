import { afterEach, describe, expect, it } from "vitest";
import { assertCheckoutEnabled, getCronSecret, getPaystackConfig } from "@/lib/env";
import { mergeItems } from "@/lib/commerce/pricing";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

function configError(fn: () => unknown) {
  try { fn(); } catch (error) { return (error as { code?: string }).code; }
  return null;
}

describe("payment configuration fails closed", () => {
  it("missing key", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(configError(getPaystackConfig)).toBe("PAYMENTS_NOT_CONFIGURED");
  });
  it("public key pasted as secret", () => {
    process.env.PAYSTACK_SECRET_KEY = "pk_test_123";
    expect(configError(getPaystackConfig)).toBe("PAYMENTS_MISCONFIGURED");
  });
  it("live key without explicit opt-in", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_live_123";
    expect(configError(getPaystackConfig)).toBe("PAYMENTS_LIVE_KEY_BLOCKED");
  });
  it("live key may only be sent to the real Paystack host", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_live_123";
    process.env.PAYSTACK_ALLOW_LIVE_KEYS = "true";
    process.env.PAYSTACK_API_BASE_URL = "https://evil.example.com";
    expect(configError(getPaystackConfig)).toBe("PAYMENTS_MISCONFIGURED");
    delete process.env.PAYSTACK_API_BASE_URL;
    expect(getPaystackConfig()).toMatchObject({ mode: "live", apiBaseUrl: "https://api.paystack.co" });
  });
  it("rejects plain-http provider URLs other than loopback", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_123";
    process.env.PAYSTACK_API_BASE_URL = "http://api.paystack.co";
    expect(configError(getPaystackConfig)).toBe("PAYMENTS_MISCONFIGURED");
  });
  it("checkout is off unless explicitly enabled", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_123";
    process.env.DATABASE_URL = "postgresql://x";
    process.env.APP_BASE_URL = "https://example.com";
    delete process.env.CHECKOUT_ENABLED;
    expect(configError(assertCheckoutEnabled)).toBe("CHECKOUT_DISABLED");
    process.env.CHECKOUT_ENABLED = "true";
    expect(configError(assertCheckoutEnabled)).toBeNull();
  });
  it("cron secret must be long", () => {
    process.env.CRON_SECRET = "short";
    expect(configError(getCronSecret)).toBe("CRON_NOT_CONFIGURED");
  });
});

describe("mergeItems", () => {
  it("combines repeated variants and sorts for consistent lock ordering", () => {
    expect(mergeItems([{ variantId: "b", quantity: 1 }, { variantId: "a", quantity: 2 }, { variantId: "b", quantity: 3 }])).toEqual([{ variantId: "a", quantity: 2 }, { variantId: "b", quantity: 4 }]);
  });
  it("enforces the per-product limit after merging", () => {
    expect(() => mergeItems([{ variantId: "a", quantity: 30 }, { variantId: "a", quantity: 30 }])).toThrow(/maximum of 50/);
  });
});
