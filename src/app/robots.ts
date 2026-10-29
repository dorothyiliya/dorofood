import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { seoSettings, siteOrigin } from "@/lib/seo/site";

/**
 * Search engines may crawl the shop and blog, never the admin, checkout or
 * API. Everything is blocked on the admin host, on preview deployments, and
 * while "Hide the whole site from search engines" is on.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = ((await headers()).get("host") ?? "").toLowerCase().split(":")[0];
  const adminHost = process.env.ADMIN_HOST?.trim().toLowerCase();
  const hidden = (adminHost && host === adminHost) || process.env.VERCEL_ENV === "preview" || (await seoSettings().then((s) => s.hideFromSearch, () => false));
  if (hidden) return { rules: { userAgent: "*", disallow: "/" } };
  const origin = siteOrigin();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/checkout"] },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
