import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { liveWhere } from "@/lib/blog/posts";

/** What the public site may read: live posts and pages only, never drafts or scheduled ones. */

export const POSTS_PER_PAGE = 12;

const card = { id: true, title: true, slug: true, excerpt: true, contentText: true, featuredImageUrl: true, featuredImageAlt: true, publishedAt: true, updatedAt: true, wordCount: true, categories: { select: { name: true, slug: true } }, author: { select: { name: true } } } satisfies Prisma.PostSelect;
export type PostCard = Prisma.PostGetPayload<{ select: typeof card }>;

export function summary(post: Pick<PostCard, "excerpt" | "contentText">, max = 180) {
  const source = (post.excerpt || post.contentText).replace(/\s+/g, " ").trim();
  return source.length > max ? `${source.slice(0, max).replace(/\s+\S*$/, "")}…` : source;
}

export async function listPosts({ page = 1, categorySlug, tagSlug, q }: { page?: number; categorySlug?: string; tagSlug?: string; q?: string } = {}) {
  if (!isDatabaseConfigured()) return { posts: [] as PostCard[], hasNext: false };
  const where: Prisma.PostWhereInput = {
    type: "POST",
    ...liveWhere(),
    ...(categorySlug ? { categories: { some: { slug: categorySlug } } } : {}),
    ...(tagSlug ? { tags: { some: { slug: tagSlug } } } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { contentText: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const rows = await prisma.post.findMany({ where, select: card, orderBy: { publishedAt: "desc" }, skip: (page - 1) * POSTS_PER_PAGE, take: POSTS_PER_PAGE + 1 });
  return { posts: rows.slice(0, POSTS_PER_PAGE), hasNext: rows.length > POSTS_PER_PAGE };
}

export const getLivePost = cache(async (type: "POST" | "PAGE", slug: string) => {
  if (!isDatabaseConfigured() || !/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  return prisma.post.findFirst({
    where: { type, slug, ...liveWhere() },
    include: { author: { select: { name: true } }, categories: { select: { name: true, slug: true } }, tags: { select: { name: true, slug: true } } },
  });
});

export async function relatedPosts(postId: string, categorySlugs: string[], take = 3) {
  const base = { type: "POST" as const, id: { not: postId }, ...liveWhere() };
  const same = categorySlugs.length ? await prisma.post.findMany({ where: { ...base, categories: { some: { slug: { in: categorySlugs } } } }, select: card, orderBy: { publishedAt: "desc" }, take }) : [];
  if (same.length >= take) return same;
  const more = await prisma.post.findMany({ where: { ...base, id: { notIn: [postId, ...same.map((p) => p.id)] } }, select: card, orderBy: { publishedAt: "desc" }, take: take - same.length });
  return [...same, ...more];
}

export const blogCategories = cache(async () => {
  if (!isDatabaseConfigured()) return [];
  return prisma.blogCategory.findMany({ where: { posts: { some: { type: "POST", ...liveWhere() } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true, slug: true, description: true } });
});

/** Pages staff chose to list in the shop footer. */
export const footerPages = cache(async () => {
  if (!isDatabaseConfigured()) return [];
  try {
    return await prisma.post.findMany({ where: { type: "PAGE", showInFooter: true, ...liveWhere() }, select: { title: true, slug: true }, orderBy: { title: "asc" }, take: 12 });
  } catch {
    return [];
  }
});

/** Product slugs for "Shop this post", in the order staff chose them. */
export async function productSlugs(productIds: string[]) {
  if (!productIds.length) return [];
  const rows = await prisma.product.findMany({ where: { id: { in: productIds }, status: "ACTIVE" }, select: { id: true, slug: true } });
  return productIds.map((id) => rows.find((r) => r.id === id)?.slug).filter((s): s is string => Boolean(s));
}
