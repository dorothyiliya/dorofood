import "server-only";
import { ConfigError } from "@/lib/env";
import type { IntegrationKey } from "@/lib/integrations/definitions";
import { recordTestResult } from "@/lib/integrations/store";
import { testAi } from "@/lib/integrations/ai";
import { getEmailConfig, sendEmail } from "@/lib/integrations/email";
import { testStorage } from "@/lib/integrations/storage";
import { testPaystack } from "@/lib/payments/paystack";
import { testWhop } from "@/lib/payments/whop";
import { ProviderRejectedError, ProviderUnavailableError } from "@/lib/payments/types";
import { BRAND } from "@/lib/brand";

async function testEmail(toEmail: string) {
  const config = await getEmailConfig();
  if (!config) throw new ConfigError("EMAIL_NOT_CONFIGURED", "Resend is not configured or is switched off.");
  await sendEmail(config, {
    to: toEmail,
    subject: `${BRAND.name}: test email`,
    text: "This is a test from Integrations in the admin. Order emails will be sent from this address.",
    html: "<p>This is a test from Integrations in the admin. Order emails will be sent from this address.</p>",
    idempotencyKey: `integration-test-${Date.now()}`,
  });
  return `Sent a test email to ${toEmail}.`;
}

/** Runs a live check against the provider, records the result, and reports it. Never exposes secrets. */
export async function testIntegration(key: IntegrationKey, staff: { id: string; email: string }) {
  let ok = false;
  let message: string;
  try {
    message = key === "paystack" ? await testPaystack()
      : key === "whop" ? await testWhop()
      : key === "nvidia" ? await testAi()
      : key === "resend" ? await testEmail(staff.email)
      : await testStorage();
    ok = true;
  } catch (error) {
    message = error instanceof ConfigError ? error.message
      : error instanceof ProviderRejectedError ? `Rejected: ${error.message}`
      : error instanceof ProviderUnavailableError ? `Could not reach the provider: ${error.message}`
      : "Unexpected error while testing.";
    if (!(error instanceof ConfigError || error instanceof ProviderRejectedError || error instanceof ProviderUnavailableError)) console.error("[integrations] test failed", key, error);
  }
  await recordTestResult(key, ok, message, staff.id);
  return { ok, message };
}
