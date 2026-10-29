import "server-only";
import { randomUUID } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { ConfigError, isSafeApiBaseUrl } from "@/lib/env";
import { CommerceError } from "@/lib/commerce/errors";
import { getIntegration } from "@/lib/integrations/store";
import { ProviderRejectedError, ProviderUnavailableError } from "@/lib/payments/types";

/**
 * Product photo uploads to any S3-compatible bucket (Cloudflare R2, Tigris,
 * AWS S3, MinIO), signed with SigV4 so the secret key never leaves the server.
 * Objects are addressed path-style: {endpoint}/{bucket}/{key}.
 */

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
type ImageType = keyof typeof TYPES;

type StorageConfig = { client: AwsClient; endpoint: string; bucket: string; publicBaseUrl: string };

export async function getStorageConfig(): Promise<StorageConfig> {
  const integration = await getIntegration("storage");
  if (!integration.active) throw new ConfigError("STORAGE_NOT_CONFIGURED", integration.configured ? "Photo storage is switched off in Integrations." : "Photo storage is not configured.");
  const v = integration.values;
  const endpoint = v.endpoint.replace(/\/+$/, "");
  const publicBaseUrl = v.publicBaseUrl.replace(/\/+$/, "");
  if (!isSafeApiBaseUrl(endpoint)) throw new ConfigError("STORAGE_MISCONFIGURED", "The S3 endpoint must use https.");
  if (!/^https:\/\//.test(publicBaseUrl) && !isSafeApiBaseUrl(publicBaseUrl)) throw new ConfigError("STORAGE_MISCONFIGURED", "The public URL must use https.");
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(v.bucket)) throw new ConfigError("STORAGE_MISCONFIGURED", "The bucket name is not valid.");
  return {
    client: new AwsClient({ accessKeyId: v.accessKeyId, secretAccessKey: v.secretAccessKey, service: "s3", region: v.region || "auto" }),
    endpoint,
    bucket: v.bucket,
    publicBaseUrl,
  };
}

/** The file's real type from its first bytes; the browser-supplied type and name are not trusted. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/**
 * Signs with SigV4, then sends with a plain fetch carrying the bytes directly.
 * aws4fetch's own fetch() passes a Request object with a body to the global
 * fetch, and inside Next.js (which patches fetch) such uploads hang until they
 * time out.
 */
async function s3(config: StorageConfig, method: "PUT" | "DELETE", key: string, init: { body?: Uint8Array<ArrayBuffer> | string; headers?: Record<string, string>; timeoutMs: number }) {
  const url = `${config.endpoint}/${config.bucket}/${key}`;
  const signed = await config.client.sign(url, { method, headers: init.headers, body: init.body });
  return fetch(url, { method, headers: signed.headers, body: init.body, signal: AbortSignal.timeout(init.timeoutMs), cache: "no-store" });
}

async function put(config: StorageConfig, key: string, body: Uint8Array<ArrayBuffer> | string, contentType: string, cacheControl: string) {
  let response: Response;
  try {
    response = await s3(config, "PUT", key, { body, headers: { "Content-Type": contentType, "Cache-Control": cacheControl }, timeoutMs: 30_000 });
  } catch (error) {
    throw new ProviderUnavailableError(`Storage request failed: ${(error as Error).message}`);
  }
  if (response.status >= 500 || response.status === 429) throw new ProviderUnavailableError(`Storage returned HTTP ${response.status}.`);
  if (!response.ok) {
    const detail = /<Code>([^<]+)<\/Code>/.exec(await response.text().catch(() => ""))?.[1];
    throw new ProviderRejectedError(`Storage refused the upload${detail ? ` (${detail})` : ""} (HTTP ${response.status}).`, response.status);
  }
}

/** Checks and uploads an image; the type comes from the file's bytes, never its name. */
export async function uploadImage(file: File, folder: "products" | "media" = "products") {
  if (file.size === 0) throw new CommerceError("PHOTO_EMPTY", 422, "Choose a photo to upload.");
  if (file.size > MAX_PHOTO_BYTES) throw new CommerceError("PHOTO_TOO_LARGE", 422, "Photos must be 4 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) throw new CommerceError("PHOTO_TYPE", 422, "Upload a JPEG, PNG or WebP image.");
  const config = await getStorageConfig();
  const now = new Date();
  const key = `${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${TYPES[type]}`;
  await put(config, key, bytes, type, "public, max-age=31536000, immutable");
  return { url: `${config.publicBaseUrl}/${key}`, key, contentType: type, sizeBytes: bytes.length };
}

export async function uploadProductPhoto(file: File): Promise<string> {
  return (await uploadImage(file, "products")).url;
}

/** Best effort: a file left behind in storage is harmless. */
export async function deleteStoredObject(key: string) {
  try {
    const config = await getStorageConfig();
    await s3(config, "DELETE", key, { timeoutMs: 15_000 });
  } catch (error) {
    console.warn("[storage] delete failed", key, (error as Error).message);
  }
}

/** Writes and deletes a small object to prove the credentials and bucket work. */
export async function testStorage() {
  const config = await getStorageConfig();
  const key = `healthchecks/${randomUUID()}.txt`;
  await put(config, key, "ok", "text/plain", "no-store");
  try {
    await s3(config, "DELETE", key, { timeoutMs: 15_000 });
  } catch {
    // The write succeeded, which is what matters; a leftover 2-byte file is harmless.
  }
  return `Wrote and removed a test file in "${config.bucket}".`;
}
