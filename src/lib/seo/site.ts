import "server-only";
import type { Metadata } from "next";
import { permanentRedirect, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAppBaseUrl } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { BRAND } from "@/lib/brand";

/** The public shop address, e.g. https://www.dorocityfoods.com. */
export function siteOrigin() {
  try {
    return getAppBaseUrl();
  } catch {
    return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  }
}

export function absoluteUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${siteOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

export { applyTitlePattern } from "@/lib/seo/title";
import { applyTitlePattern } from "@/lib/seo/title";

export async function seoSettings() {
  const s = await getSettings();
  return {
    titlePattern: s["seo.titleTemplate"],
    homeTitle: s["seo.homeTitle"],
    description: s["seo.defaultDescription"],
    socialImage: s["seo.socialImage"],
    socialProfiles: s["seo.socialProfiles"].split(/\s+/).filter((u) => /^https:\/\/\S+$/.test(u)),
    googleVerification: s["seo.googleVerification"],
    bingVerification: s["seo.bingVerification"],
    hideFromSearch: s["seo.hideFromSearch"],
    blogTitle: s["blog.title"],
    blogDescription: s["blog.description"],
  };
}

/**
 * Metadata for a public page: title with the site pattern, description,
 * canonical address, sharing preview, and the index/noindex decision.
 */
export async function pageMetadata(input: {
  title: string;
  /** Use the title exactly as given (already includes the shop name). */
  absoluteTitle?: boolean;
  description?: string | null;
  path: string;
  canonical?: string | null;
  image?: { url: string; alt?: string | null } | null;
  type?: "website" | "article";
  publishedTime?: Date | null;
  modifiedTime?: Date | null;
  author?: string | null;
  noindex?: boolean;
}): Promise<Metadata> {
  const seo = await seoSettings();
  const title = input.absoluteTitle ? input.title : applyTitlePattern(input.title, seo.titlePattern);
  const description = (input.description?.trim() || seo.description).slice(0, 320);
  const url = absoluteUrl(input.path);
  const imageUrl = input.image?.url || seo.socialImage || null;
  const images = imageUrl ? [{ url: absoluteUrl(imageUrl), alt: input.image?.alt || title }] : undefined;
  const hidden = seo.hideFromSearch || input.noindex;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: input.canonical?.trim() || url },
    openGraph: {
      title, description, url, siteName: BRAND.name, locale: "en_NG", type: input.type ?? "website", images,
      ...(input.type === "article" ? { publishedTime: input.publishedTime?.toISOString(), modifiedTime: input.modifiedTime?.toISOString(), authors: input.author ? [input.author] : undefined } : {}),
    },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images: images?.map((i) => i.url) },
    robots: hidden ? { index: false, follow: !seo.hideFromSearch } : { index: true, follow: true, "max-image-preview": "large" },
  };
}

/** Safe JSON-LD: "<" escaped so the script can never be closed early. */
export function jsonLd(data: unknown) {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}

export async function organizationJsonLd() {
  const seo = await seoSettings();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND.name,
    url: siteOrigin(),
    logo: absoluteUrl(BRAND.mark.light),
    ...(seo.socialProfiles.length ? { sameAs: seo.socialProfiles } : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: absoluteUrl(item.path) })),
  };
}

/**
 * Called where a page would otherwise be "not found": follows a saved
 * redirect for this address if there is one (and counts the visit).
 */
export async function followRedirect(path: string) {
  const fromPath = normalisePath(path);
  const found = await prisma.redirect.findUnique({ where: { fromPath } }).catch(() => null);
  if (!found) return;
  await prisma.redirect.update({ where: { id: found.id }, data: { hits: { increment: 1 }, lastHitAt: new Date() } }).catch(() => undefined);
  if (found.permanent) permanentRedirect(found.toPath);
  redirect(found.toPath);
}

export function normalisePath(path: string) {
  let p = path.trim();
  try { if (/^https?:\/\//.test(p)) p = new URL(p).pathname; } catch { /* keep as typed */ }
  p = `/${p.replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/";
  return p.split("?")[0].split("#")[0].toLowerCase();
}
