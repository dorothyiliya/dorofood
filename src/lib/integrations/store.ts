import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { CommerceError } from "@/lib/commerce/errors";
import { canEncrypt, decryptSecrets, encryptSecrets, hint } from "@/lib/integrations/crypto";
import { definition, INTEGRATIONS, type IntegrationKey } from "@/lib/integrations/definitions";

export type FieldSource = "env" | "admin" | "default" | "missing";

export type ResolvedIntegration = {
  key: IntegrationKey;
  /** Every required field has a value. */
  configured: boolean;
  /** Configured and switched on: safe for live code to use. */
  active: boolean;
  enabled: boolean;
  values: Record<string, string>;
  sources: Record<string, FieldSource>;
  hints: Record<string, string>;
  lastTest: { at: Date | null; ok: boolean | null; message: string | null };
  storageError: string | null;
};

/**
 * Current configuration for one integration. Environment variables override
 * values saved in the admin; an integration configured only through
 * environment variables is active unless an admin explicitly disabled it.
 */
export async function getIntegration(key: IntegrationKey): Promise<ResolvedIntegration> {
  const def = definition(key);
  const row = process.env.DATABASE_URL ? await prisma.integration.findUnique({ where: { key } }) : null;
  let saved: Record<string, string> = {};
  let storageError: string | null = null;
  if (row?.secretsCipher) {
    try {
      saved = decryptSecrets(key, row.secretsCipher);
    } catch (error) {
      // Wrong or rotated encryption key: treat stored secrets as absent, never crash checkout.
      storageError = (error as Error).message.includes("INTEGRATIONS_ENCRYPTION_KEY") ? (error as Error).message : "Saved secrets could not be decrypted (encryption key changed?). Re-enter them.";
    }
  }
  const settings = (row?.settingsJson ?? {}) as Record<string, string>;

  const values: Record<string, string> = {};
  const sources: Record<string, FieldSource> = {};
  let anyEnv = false;
  for (const field of def.fields) {
    const env = field.env ? process.env[field.env]?.trim() : undefined;
    const stored = field.secret ? saved[field.key] : settings[field.key];
    if (env) { values[field.key] = env; sources[field.key] = "env"; anyEnv = true; }
    else if (stored) { values[field.key] = stored; sources[field.key] = "admin"; }
    else if (field.default !== undefined) { values[field.key] = field.default; sources[field.key] = "default"; }
    else sources[field.key] = "missing";
  }
  const configured = def.fields.every((f) => !f.required || Boolean(values[f.key]));
  const enabled = row ? row.enabled : anyEnv;
  return {
    key,
    configured,
    active: configured && enabled,
    enabled,
    values,
    sources,
    hints: (row?.secretHints ?? {}) as Record<string, string>,
    lastTest: { at: row?.lastTestAt ?? null, ok: row?.lastTestOk ?? null, message: row?.lastTestMessage ?? null },
    storageError,
  };
}

export async function getAllIntegrations() {
  return Promise.all(INTEGRATIONS.map((d) => getIntegration(d.key)));
}

/**
 * Saves settings and any newly entered secrets. Blank secret inputs keep the
 * saved value; `clear` lists secrets to remove. Values are never logged or audited.
 */
export async function saveIntegration(
  key: IntegrationKey,
  input: { enabled: boolean; settings: Record<string, string>; secrets: Record<string, string>; clear?: string[] },
  actorId: string,
) {
  const def = definition(key);
  const settingKeys = new Set(def.fields.filter((f) => !f.secret).map((f) => f.key));
  const secretKeys = new Set(def.fields.filter((f) => f.secret).map((f) => f.key));
  const newSecrets = Object.fromEntries(Object.entries(input.secrets).filter(([k, v]) => secretKeys.has(k) && v.trim()).map(([k, v]) => [k, v.trim()]));
  if (Object.keys(newSecrets).length && !canEncrypt()) {
    throw new CommerceError("ENCRYPTION_KEY_MISSING", 503, "Set INTEGRATIONS_ENCRYPTION_KEY in Vercel before saving secrets here, or set this integration's environment variables instead.");
  }
  for (const [k, v] of Object.entries(input.settings)) {
    if (settingKeys.has(k) && v.length > 500) throw new CommerceError("INVALID_SETTING", 422, `${k} is too long.`);
  }

  await prisma.$transaction(async (tx) => {
    const row = await tx.integration.findUnique({ where: { key } });
    let secrets: Record<string, string> = {};
    if (row?.secretsCipher && canEncrypt()) {
      try { secrets = decryptSecrets(key, row.secretsCipher); } catch { secrets = {}; }
    }
    for (const k of input.clear ?? []) delete secrets[k];
    Object.assign(secrets, newSecrets);

    // Fields not submitted (for example, ones set by environment variables) keep their saved value.
    const submitted = Object.fromEntries(Object.entries(input.settings).filter(([k]) => settingKeys.has(k)).map(([k, v]) => [k, v.trim()]));
    const settings = { ...((row?.settingsJson ?? {}) as Record<string, string>), ...submitted };
    const hints = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, hint(v)]));
    const data = {
      enabled: input.enabled,
      settingsJson: settings as Prisma.InputJsonValue,
      secretsCipher: Object.keys(secrets).length ? encryptSecrets(key, secrets) : null,
      secretHints: hints as Prisma.InputJsonValue,
      updatedBy: actorId,
    };
    await tx.integration.upsert({ where: { key }, create: { key, ...data }, update: data });
    await recordAudit(tx, {
      action: "INTEGRATION_UPDATED", entityType: "Integration", entityId: key, actorId,
      metadata: { enabled: input.enabled, settingsSaved: Object.keys(submitted), secretsReplaced: Object.keys(newSecrets), secretsCleared: input.clear ?? [] },
    });
  });
}

export async function recordTestResult(key: IntegrationKey, ok: boolean, message: string, actorId: string) {
  // Creating the row must not change whether an environment-configured integration is on.
  const { enabled } = await getIntegration(key);
  await prisma.$transaction(async (tx) => {
    await tx.integration.upsert({
      where: { key },
      create: { key, enabled, lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message.slice(0, 500), updatedBy: actorId },
      update: { lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message.slice(0, 500) },
    });
    await recordAudit(tx, { action: ok ? "INTEGRATION_TEST_PASSED" : "INTEGRATION_TEST_FAILED", entityType: "Integration", entityId: key, actorId, metadata: { message: message.slice(0, 200) } });
  });
}
