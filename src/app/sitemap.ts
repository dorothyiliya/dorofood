import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { liveWhere, postPath } from "@/lib/blog/posts";
import { loadStorefront } from "@/lib/storefront-data";
import { absoluteUrl, seoSettings } from "@/lib/seo/site";

// Built on request, so it is always current and builds never depend on the database.
export const dynamic = "force-dynamic";

/** Every public page Google should know about. Drafts, hidden pages and the admin are never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isDatabaseConfigured()) return [{ url: absoluteUrl("/") }];
  const seo = await seoSettings();
  if (seo.hideFromSearch) return [];
  const [store, posts, categories] = await Promise.all([
    loadStorefront(),
    prisma.post.findMany({ where: { ...liveWhere(), noindex: false, canonicalUrl: null }, select: { type: true, slug: true, updatedAt: true }, orderBy: { publishedAt: "desc" }, take: 5000 }),
    prisma.blogCategory.findMany({ where: { posts: { some: { type: "POST", ...liveWhere() } } }, select: { slug: true, updatedAt: true } }),
  ]);
  const now = new Date();
  const productSlugs = store.source === "database" ? [...new Set(store.products.map((p) => p.slug))] : [];
  const latestPost = posts.find((p) => p.type === "POST")?.updatedAt ?? now;
  return [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/shop"), lastModified: now, changeFrequency: "daily", priority: 0.9 },
    ...productSlugs.map((slug) => ({ url: absoluteUrl(`/products/${slug}`), lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...(posts.some((p) => p.type === "POST") ? [{ url: absoluteUrl("/blog"), lastModified: latestPost, changeFrequency: "daily" as const, priority: 0.7 }] : []),
    ...posts.map((p) => ({ url: absoluteUrl(postPath(p.type, p.slug)), lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: p.type === "PAGE" ? 0.5 : 0.6 })),
    ...categories.map((c) => ({ url: absoluteUrl(`/blog/category/${c.slug}`), lastModified: c.updatedAt, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
