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

  /* Search engines (edited on the SEO page). */
  "seo.titleTemplate": {
    group: "seo",
    label: "Title pattern",
    help: "How page titles look on Google and in browser tabs. {title} is replaced by each page's own title.",
    schema: z.string().trim().max(90).refine((v) => v.includes("{title}"), "The pattern must include {title}."),
    default: "{title} | Dorocity Foods",
  },
  "seo.homeTitle": {
    group: "seo",
    label: "Home page title",
    help: "The title of your home page on Google. Include what you sell.",
    schema: z.string().trim().min(5, "Enter a home page title.").max(90),
    default: "Dorocity Foods | Nigerian groceries online",
  },
  "seo.defaultDescription": {
    group: "seo",
    label: "Shop description",
    help: "Shown on Google under your home page, and used for any page without its own description.",
    schema: z.string().trim().min(20, "Write at least a sentence.").max(320),
    default: "Nigerian groceries, snacks, drinks and pantry staples, priced in naira with delivery shown before you pay.",
  },
  "seo.socialImage": {
    group: "seo",
    label: "Sharing picture",
    help: "Shown when someone shares your site on WhatsApp, Facebook or X and the page has no picture of its own.",
    schema: z.union([z.literal(""), z.string().trim().url("Use a full picture address starting with https://").max(2000)]),
    default: "",
  },
  "seo.socialProfiles": {
    group: "seo",
    label: "Your social media pages",
    help: "One address per line (Instagram, Facebook, TikTok...). Helps Google connect them to your shop.",
    schema: z.string().trim().max(2000),
    default: "",
  },
  "seo.googleVerification": {
    group: "seo",
    label: "Google Search Console code",
    help: "From Search Console: choose the HTML tag option and paste only the code inside content=\"...\".",
    schema: z.string().trim().max(200).regex(/^[A-Za-z0-9_-]*$/, "Paste only the code, without quotes or the <meta> tag."),
    default: "",
  },
  "seo.bingVerification": {
    group: "seo",
    label: "Bing Webmaster code",
    help: "Optional. The code from Bing Webmaster Tools.",
    schema: z.string().trim().max(200).regex(/^[A-Za-z0-9_-]*$/, "Paste only the code, without quotes or the <meta> tag."),
    default: "",
  },
  "seo.hideFromSearch": {
    group: "seo",
    label: "Hide the whole site from search engines",
    help: "Only for a site that isn't ready yet. While this is on, Google won't list any of your pages.",
    schema: z.boolean(),
    default: false,
  },
  "blog.title": {
    group: "seo",
    label: "Blog name",
    help: "Shown at the top of the blog and in its Google title.",
    schema: z.string().trim().min(2, "Enter a blog name.").max(60),
    default: "The Dorocity Kitchen",
  },
  "blog.description": {
    group: "seo",
    label: "Blog description",
    help: "One sentence about what you write about.",
    schema: z.string().trim().max(300),
    default: "Recipes, food stories and news from Dorocity Foods.",
  },
} as const;

/** Settings shown on the Shop settings page (the rest have their own pages). */
export const SHOP_SETTING_KEYS = (Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]).filter((k) => !("group" in SETTINGS[k]));

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
