import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { jsonSafe, recordAudit } from "@/lib/audit";

/**
 * Runtime store configuration, editable from the admin. Every key here is
 * read by live code; nothing is a placeholder.
 */
export const SETTINGS = {
  "checkout.open": {
    label: "Store accepts orders",
    help: "Checkout also needs CHECKOUT_ENABLED=true on the deployment and a Paystack key. Off by default.",
    schema: z.boolean(),
    default: false,
  },
  "checkout.paymentWindowMinutes": {
    label: "Payment window (minutes)",
    help: "How long stock is held for an unpaid checkout before it is released.",
    schema: z.number().int().min(5).max(1440),
    default: 30,
  },
  "fulfilment.locationCode": {
    label: "Fulfilment location",
    help: "Stock is reserved from, and availability is shown for, this location.",
    schema: z.string().trim().min(1).max(40),
    default: "NG-MAIN",
  },
  "inventory.lowStockThreshold": {
    label: "Low-stock alert threshold",
    help: "Products with this many sellable units or fewer appear on the dashboard.",
    schema: z.number().int().min(0).max(100000),
    default: 5,
  },
  "storefront.previewMode": {
    label: "Storefront preview mode",
    help: "Labels the shop as a preview, and shows sample products when the catalogue is empty.",
    schema: z.boolean(),
    default: true,
  },
  "storefront.announcement": {
    label: "Announcement bar",
    help: "Shown at the top of every storefront page. Leave empty to hide.",
    schema: z.string().trim().max(160),
    default: "Store preview. Online ordering opens soon.",
  },
  "store.contactEmail": {
    label: "Contact email",
    help: "Used for the storefront Contact link.",
    schema: z.string().trim().pipe(z.email()),
    default: "hello@dorocityfoods.com",
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS)[K]["schema"]> };
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

type Db = PrismaClient | Prisma.TransactionClient;

export async function getSettings(db: Db = prisma): Promise<Settings> {
  const rows = await db.storeSetting.findMany();
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const result = {} as Record<SettingKey, unknown>;
  for (const key of SETTING_KEYS) {
    const def = SETTINGS[key];
    const parsed = stored.has(key) ? def.schema.safeParse(stored.get(key)) : null;
    // A stored value that no longer validates falls back to the safe default.
    result[key] = parsed?.success ? parsed.data : def.default;
  }
  return result as Settings;
}

export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma): Promise<Settings[K]> {
  return (await getSettings(db))[key];
}

export async function updateSettings(changes: Partial<Record<SettingKey, unknown>>, actorId: string) {
  const parsed: Partial<Settings> = {};
  for (const [key, value] of Object.entries(changes) as [SettingKey, unknown][]) {
    if (!(key in SETTINGS)) throw new Error(`Unknown setting ${key}`);
    const result = SETTINGS[key].schema.safeParse(value);
    if (!result.success) throw new z.ZodError(result.error.issues.map((i) => ({ ...i, path: [key, ...i.path] })));
    (parsed as Record<string, unknown>)[key] = result.data;
  }
  await prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    for (const [key, value] of Object.entries(parsed)) {
      await tx.storeSetting.upsert({ where: { key }, create: { key, value: jsonSafe(value), updatedBy: actorId }, update: { value: jsonSafe(value), updatedBy: actorId } });
    }
    const diff = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => before[k as SettingKey] !== v).map(([k, v]) => [k, { from: before[k as SettingKey], to: v }]));
    if (Object.keys(diff).length) await recordAudit(tx, { action: "SETTINGS_UPDATED", entityType: "StoreSetting", entityId: "store", actorId, metadata: diff });
  });
}
