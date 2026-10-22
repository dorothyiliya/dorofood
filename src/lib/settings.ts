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
    label: "Shop is open for orders",
    help: "When this is off, customers can browse but not buy. Turn it on when you are ready to sell.",
    schema: z.boolean(),
    default: false,
  },
  "checkout.paymentWindowMinutes": {
    label: "Minutes to pay",
    help: "How long items stay held for a customer who has started paying. After that they go back on sale.",
    schema: z.number().int().min(5).max(1440),
    default: 30,
  },
  "fulfilment.locationCode": {
    label: "Where orders are packed from",
    help: "The stock location orders use. Most shops have just one; leave this as it is.",
    schema: z.string().trim().min(1).max(40),
    default: "NG-MAIN",
  },
  "inventory.lowStockThreshold": {
    label: "Warn me when stock gets this low",
    help: "Products with this many or fewer left are listed on the Home page.",
    schema: z.number().int().min(0).max(100000),
    default: 5,
  },
  "storefront.previewMode": {
    label: "Show the shop as a preview",
    help: "Marks the shop as \"coming soon\" and shows example products until you add your own. Turn off when you launch.",
    schema: z.boolean(),
    default: true,
  },
  "storefront.announcement": {
    label: "Message bar",
    help: "A short message at the top of every page of the shop. Leave empty to hide it.",
    schema: z.string().trim().max(160),
    default: "Store preview. Online ordering opens soon.",
  },
  "store.contactEmail": {
    label: "Contact email",
    help: "Where customers' emails go when they press Contact in the shop.",
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
