import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ConfigError } from "@/lib/env";

/**
 * AES-256-GCM for integration secrets at rest. The key comes from
 * INTEGRATIONS_ENCRYPTION_KEY (any string of 32+ characters; hashed to 32 bytes).
 * The integration key is bound as associated data, so a ciphertext copied onto
 * another integration's row fails to decrypt.
 */

function key() {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (!raw || raw.length < 32) {
    throw new ConfigError("ENCRYPTION_KEY_MISSING", "INTEGRATIONS_ENCRYPTION_KEY must be set (32+ characters) before secrets can be stored in the admin.");
  }
  return createHash("sha256").update(raw).digest();
}

export function canEncrypt() {
  return (process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim().length ?? 0) >= 32;
}

export function encryptSecrets(integration: string, secrets: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`integration:${integration}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecrets(integration: string, payload: string): Record<string, string> {
  const [version, iv, tag, body] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(`integration:${integration}`));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const text = Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(text) as Record<string, string>;
}

/** What the admin may show about a saved secret: never more than the last four characters. */
export function hint(value: string) {
  return value.length <= 8 ? "saved" : `ends ${value.slice(-4)}`;
}
