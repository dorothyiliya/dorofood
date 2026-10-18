import "server-only";
import { ConfigError, isSafeApiBaseUrl } from "@/lib/env";
import { getIntegration } from "@/lib/integrations/store";
import { ProviderRejectedError, ProviderUnavailableError } from "@/lib/payments/types";

/** Transactional email through Resend (https://resend.com/docs/api-reference/emails/send-email). */

export type EmailConfig = { apiKey: string; from: string; replyTo: string | null; apiBaseUrl: string };

/** Null when email is not set up or switched off: callers skip sending rather than fail. */
export async function getEmailConfig(): Promise<EmailConfig | null> {
  const integration = await getIntegration("resend");
  if (!integration.active) return null;
  const apiBaseUrl = (process.env.RESEND_API_BASE_URL?.trim() || "https://api.resend.com").replace(/\/+$/, "");
  if (!isSafeApiBaseUrl(apiBaseUrl)) throw new ConfigError("EMAIL_MISCONFIGURED", "RESEND_API_BASE_URL must use https.");
  return { apiKey: integration.values.apiKey, from: integration.values.from, replyTo: integration.values.replyTo || null, apiBaseUrl };
}

export async function sendEmail(config: EmailConfig, message: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey.slice(0, 256) },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new ProviderUnavailableError(`Resend request failed: ${(error as Error).message}`);
  }
  const payload = (await response.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
  if (response.status >= 500 || response.status === 429 || payload === null) throw new ProviderUnavailableError(`Resend returned HTTP ${response.status}.`);
  if (!response.ok) throw new ProviderRejectedError(payload.message || `Resend rejected the email (HTTP ${response.status}).`, response.status);
  if (!payload.id) throw new ProviderUnavailableError("Resend did not return a message id.");
  return { id: payload.id };
}
