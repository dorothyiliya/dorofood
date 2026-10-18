import "server-only";
import { ConfigError, isSafeApiBaseUrl } from "@/lib/env";
import { getIntegration } from "@/lib/integrations/store";
import { ProviderRejectedError, ProviderUnavailableError } from "@/lib/payments/types";

/**
 * NVIDIA-hosted models through the OpenAI-compatible API at build.nvidia.com.
 * Output is only ever a draft placed in a form for staff to review; nothing the
 * model writes is published or acted on without a person saving it.
 */

type AiConfig = { apiKey: string; model: string; baseUrl: string };

export async function getAiConfig(): Promise<AiConfig> {
  const integration = await getIntegration("nvidia");
  if (!integration.active) throw new ConfigError("AI_NOT_CONFIGURED", integration.configured ? "NVIDIA AI is switched off in Integrations." : "NVIDIA AI is not configured.");
  const baseUrl = integration.values.baseUrl.replace(/\/+$/, "");
  if (!isSafeApiBaseUrl(baseUrl)) throw new ConfigError("AI_MISCONFIGURED", "The NVIDIA API endpoint must use https.");
  // The key goes wherever the endpoint points, so an endpoint typed into the admin
  // must be NVIDIA's own. Self-hosted NIMs are configured through NVIDIA_BASE_URL.
  const host = new URL(baseUrl).hostname;
  if (integration.sources.baseUrl === "admin" && host !== "nvidia.com" && !host.endsWith(".nvidia.com")) {
    throw new ConfigError("AI_MISCONFIGURED", "Only an nvidia.com endpoint can be set in the admin. Use the NVIDIA_BASE_URL environment variable for a self-hosted NIM.");
  }
  return { apiKey: integration.values.apiKey, model: integration.values.model, baseUrl };
}

export async function chat(config: AiConfig, messages: { role: "system" | "user"; content: string }[], options: { maxTokens?: number; temperature?: number } = {}) {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model: config.model, messages, max_tokens: options.maxTokens ?? 400, temperature: options.temperature ?? 0.6, stream: false }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new ProviderUnavailableError(`NVIDIA request failed: ${(error as Error).message}`);
  }
  const payload = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; detail?: string; error?: { message?: string } | string } | null;
  if (response.status === 401 || response.status === 403) throw new ProviderRejectedError("NVIDIA rejected the API key.", response.status);
  if (response.status >= 500 || response.status === 429 || payload === null) throw new ProviderUnavailableError(`NVIDIA returned HTTP ${response.status}.`);
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message ?? payload.detail;
    throw new ProviderRejectedError(message ? String(message).slice(0, 200) : `NVIDIA rejected the request (HTTP ${response.status}).`, response.status);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new ProviderUnavailableError("NVIDIA returned no text.");
  return content;
}

/** Model output as plain text: no reasoning traces, markup, or runaway length. */
export function cleanDraft(raw: string, maxLength = 1200) {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s*(#+|[-*•]\s)/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*(here(?:'s| is)[^:\n]*:|description:)\s*/i, "")
    .replace(/^["“]|["”]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .replace(/\s+\S*$/, (tail) => (raw.length > maxLength ? "…" : tail));
}

export type ProductFacts = { name: string; brand?: string; category?: string; originCountry?: string; packSizes?: string[]; notes?: string };

const SYSTEM_PROMPT = [
  "You write product descriptions for Dorocity Foods, an online shop selling Nigerian food products.",
  "Write one paragraph of 50 to 90 words in warm, plain British English for the product page.",
  "Describe taste, texture and how people use it. Use only the facts given; never invent ingredients, allergens, certifications, awards, nutrition figures or health claims.",
  "If a fact is not given, leave it out. No headings, lists, emoji, hashtags or quotation marks. Reply with the paragraph only.",
].join(" ");

export async function draftProductDescription(facts: ProductFacts) {
  const config = await getAiConfig();
  const lines = [
    `Product: ${facts.name}`,
    facts.brand && `Brand: ${facts.brand}`,
    facts.category && `Category: ${facts.category}`,
    facts.originCountry && `Made in: ${facts.originCountry}`,
    facts.packSizes?.length && `Pack sizes: ${facts.packSizes.join(", ")}`,
    facts.notes && `Notes from staff: ${facts.notes}`,
  ].filter(Boolean).join("\n");
  const text = cleanDraft(await chat(config, [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: lines }], { maxTokens: 300 }));
  if (text.length < 20) throw new ProviderUnavailableError("The model returned an unusable draft. Try again.");
  return text;
}

export async function testAi() {
  const config = await getAiConfig();
  const reply = await chat(config, [{ role: "user", content: "Reply with the single word: ready" }], { maxTokens: 10, temperature: 0 });
  return `Connected to ${config.model}. Reply: "${cleanDraft(reply, 40)}"`;
}
