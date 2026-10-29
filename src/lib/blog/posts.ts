import "server-only";
import type { Post, PostType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { jsonSafe, recordAudit } from "@/lib/audit";
import { CommerceError } from "@/lib/commerce/errors";
import { EMPTY_DOC, renderDoc, sanitizeDoc, slugifyText } from "@/lib/content/document";
import { analyse } from "@/lib/seo/analysis";
import { applyTitlePattern, normalisePath, siteOrigin } from "@/lib/seo/site";
import { getSetting } from "@/lib/settings";

/**
 * Blog posts and pages, WordPress-style: drafts, publishing, scheduling (a
 * publish date in the future), trash, revisions, categories and tags. A post
 * is live when PUBLISHED with publishedAt <= now, so scheduled posts appear on
 * time without a background job.
 */

export const REVISIONS_KEPT = 25;
const MAX_CONTENT_BYTES = 2_000_000;
/** Page addresses that would clash with the shop's own pages. */
const RESERVED = new Set(["admin", "api", "blog", "shop", "products", "checkout", "cart", "login", "search", "sitemap", "robots", "feed", "rss", "_next", "brand"]);

export function postPath(type: PostType, slug: string) {
  return type === "PAGE" ? `/${slug}` : `/blog/${slug}`;
}

/** Live right now (published and not scheduled for later). */
export function liveWhere(now = new Date()): Prisma.PostWhereInput {
  return { status: "PUBLISHED", publishedAt: { lte: now } };
}

export function postState(post: Pick<Post, "status" | "publishedAt">, now = new Date()) {
  if (post.status === "TRASHED") return "Trash" as const;
  if (post.status === "DRAFT") return "Draft" as const;
  return post.publishedAt && post.publishedAt > now ? ("Scheduled" as const) : ("Published" as const);
}

export type SavePostInput = {
  id?: string | null;
  type: PostType;
  title: string;
  slug?: string;
  excerpt?: string;
  contentJson: unknown;
  /** "draft": save as (or switch back to) a draft; "publish": publish now or at publishAt; "save": keep the current status. */
  intent: "draft" | "publish" | "save";
  publishAt?: string | null;
  featuredImageUrl?: string;
  featuredImageAlt?: string;
  categoryIds?: string[];
  tags?: string[];
  productIds?: string[];
  showInFooter?: boolean;
  seoTitle?: string;
  seoDescription?: string;
  focusKeyphrase?: string;
  canonicalUrl?: string;
  noindex?: boolean;
  socialImageUrl?: string;
  /** Autosaves don't create revisions. */
  autosave?: boolean;
};

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CommerceError("INVALID_INPUT", 422, message);
}

const text = (v: string | undefined | null, max: number) => (v ?? "").trim().slice(0, max);

async function uniqueSlug(tx: Prisma.TransactionClient, type: PostType, wanted: string, ignoreId?: string | null) {
  let root = slugifyText(wanted) || (type === "PAGE" ? "page" : "post");
  if (type === "PAGE" && RESERVED.has(root)) root = `${root}-page`;
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const clash = await tx.post.findUnique({ where: { type_slug: { type, slug: candidate } }, select: { id: true } });
    if (!clash || clash.id === ignoreId) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

function optionalUrl(value: string | undefined, label: string) {
  const v = text(value, 2000);
  if (!v) return null;
  check(/^https:\/\/\S+$/.test(v) || (v.startsWith("/") && !v.startsWith("//")), `${label} must be a full address starting with https://`);
  return v;
}

/**
 * A save is one transaction, so if the database drops it (P2028: transaction
 * closed; P2034: write conflict with a save from another tab) nothing was
 * written and it is safe to run once more.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "P2028" && code !== "P2034") throw error;
    console.warn("[blog] retrying save after", code);
    return fn();
  }
}

export async function savePost(input: SavePostInput, actorId: string) {
  const existing = input.id ? await prisma.post.findUnique({ where: { id: input.id }, include: { categories: { select: { id: true } } } }) : null;
  check(!input.id || existing, "This post no longer exists. It may have been deleted.");
  check(!existing || existing.type === input.type, "This item can't change between post and page.");
  check(existing?.status !== "TRASHED", "This is in the trash. Restore it before editing.");

  const title = text(input.title, 200);
  const publishing = input.intent === "publish" || (input.intent === "save" && existing?.status === "PUBLISHED");
  check(!publishing || title.length > 0, "Add a title before publishing.");
  check(JSON.stringify(input.contentJson ?? null).length <= MAX_CONTENT_BYTES, "This post is too large to save. Split it into two posts, or use fewer embedded items.");

  const origin = siteOrigin();
  const contentJson = sanitizeDoc(input.contentJson ?? EMPTY_DOC);
  const rendered = renderDoc(contentJson, { siteOrigin: origin });
  check(!publishing || rendered.wordCount > 0 || rendered.images.length > 0, "Add some content before publishing.");

  let publishedAt = existing?.publishedAt ?? null;
  if (input.intent === "publish") {
    if (input.publishAt) {
      const when = new Date(input.publishAt);
      check(!Number.isNaN(when.getTime()), "Choose a valid publish date and time.");
      publishedAt = when;
    } else if (!publishedAt || existing?.status !== "PUBLISHED") {
      publishedAt = new Date();
    }
  }
  const status = input.intent === "publish" ? "PUBLISHED" : input.intent === "draft" ? "DRAFT" : existing?.status ?? "DRAFT";

  const featuredImageUrl = optionalUrl(input.featuredImageUrl, "The featured image");
  const socialImageUrl = optionalUrl(input.socialImageUrl, "The sharing picture");
  const canonicalUrl = optionalUrl(input.canonicalUrl, "The original address");
  const productIds = [...new Set((input.productIds ?? []).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)))].slice(0, 8);
  if (productIds.length) {
    const found = await prisma.product.count({ where: { id: { in: productIds } } });
    check(found === productIds.length, "One of the chosen products no longer exists. Remove it and try again.");
  }
  const categoryIds = input.type === "POST" ? [...new Set(input.categoryIds ?? [])].slice(0, 20) : [];
  const tagNames = input.type === "POST" ? [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean).map((t) => t.slice(0, 50)))].slice(0, 30) : [];

  const seoTitle = text(input.seoTitle, 120) || null;
  const seoDescription = text(input.seoDescription, 320) || null;
  const focusKeyphrase = text(input.focusKeyphrase, 100) || null;
  const excerpt = text(input.excerpt, 1000) || null;

  const others = focusKeyphrase ? await prisma.post.findMany({ where: { focusKeyphrase: { not: null }, status: { not: "TRASHED" }, ...(existing ? { id: { not: existing.id } } : {}) }, select: { focusKeyphrase: true } }) : [];
  const pattern = await getSetting("seo.titleTemplate");

  const saved = await withRetry(() => prisma.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, input.type, text(input.slug, 120) || title || "untitled", existing?.id);
    const analysis = analyse({
      kind: input.type === "PAGE" ? "page" : "post",
      keyphrase: focusKeyphrase ?? "",
      seoTitle: applyTitlePattern(seoTitle || title, pattern),
      slug,
      metaDescription: seoDescription ?? excerpt ?? "",
      rendered,
      hasFeaturedImage: Boolean(featuredImageUrl),
      otherKeyphrases: others.map((o) => o.focusKeyphrase!),
    });

    const tags = [];
    for (const name of tagNames) {
      const tagSlug = slugifyText(name) || "tag";
      tags.push(await tx.blogTag.upsert({ where: { slug: tagSlug }, create: { name, slug: tagSlug }, update: {} }));
    }
    if (categoryIds.length) {
      const found = await tx.blogCategory.count({ where: { id: { in: categoryIds } } });
      check(found === categoryIds.length, "One of the chosen categories no longer exists. Reload the page.");
    }

    const data = {
      title: title || "Untitled",
      slug,
      excerpt,
      contentJson: contentJson as Prisma.InputJsonValue,
      contentHtml: rendered.html,
      contentText: rendered.text,
      wordCount: rendered.wordCount,
      status,
      publishedAt,
      featuredImageUrl,
      featuredImageAlt: featuredImageUrl ? text(input.featuredImageAlt, 300) || null : null,
      productIds,
      showInFooter: input.type === "PAGE" ? Boolean(input.showInFooter) : false,
      seoTitle,
      seoDescription,
      focusKeyphrase,
      canonicalUrl,
      noindex: Boolean(input.noindex),
      socialImageUrl,
      seoScore: analysis.seo.score,
      readabilityScore: analysis.readability.checks.length ? analysis.readability.score : null,
      categories: { set: categoryIds.map((id) => ({ id })) },
      tags: { set: tags.map((t) => ({ id: t.id })) },
    };
    const post = existing
      ? await tx.post.update({ where: { id: existing.id }, data })
      : await tx.post.create({ data: { ...data, type: input.type, authorId: actorId.startsWith("system") ? null : actorId, categories: { connect: categoryIds.map((id) => ({ id })) }, tags: { connect: tags.map((t) => ({ id: t.id })) } } });

    // A published post that moves keeps its old address working.
    if (existing?.status === "PUBLISHED" && existing.slug !== post.slug) {
      const from = postPath(existing.type, existing.slug);
      const to = postPath(post.type, post.slug);
      await tx.redirect.deleteMany({ where: { fromPath: to } });
      await tx.redirect.updateMany({ where: { toPath: from }, data: { toPath: to } });
      await tx.redirect.upsert({ where: { fromPath: from }, create: { fromPath: from, toPath: to, note: "Address changed in the editor", createdBy: actorId }, update: { toPath: to } });
    }

    if (!input.autosave) {
      const last = await tx.postRevision.findFirst({ where: { postId: post.id }, orderBy: { createdAt: "desc" } });
      const changed = !last || last.title !== post.title || JSON.stringify(last.contentJson) !== JSON.stringify(contentJson) || (last.excerpt ?? null) !== excerpt;
      if (changed) {
        await tx.postRevision.create({ data: { postId: post.id, title: post.title, excerpt, contentJson: contentJson as Prisma.InputJsonValue, authorId: actorId } });
        const stale = await tx.postRevision.findMany({ where: { postId: post.id }, orderBy: { createdAt: "desc" }, skip: REVISIONS_KEPT, select: { id: true } });
        if (stale.length) await tx.postRevision.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
      }
      const action = !existing ? "POST_CREATED" : input.intent === "publish" && existing.status !== "PUBLISHED" ? "POST_PUBLISHED" : input.intent === "draft" && existing.status === "PUBLISHED" ? "POST_UNPUBLISHED" : "POST_UPDATED";
      await recordAudit(tx, { action, entityType: input.type === "PAGE" ? "Page" : "Post", entityId: post.id, actorId, metadata: { title: post.title, slug: post.slug, status: post.status, publishedAt: post.publishedAt } });
    }
    return post;
  }, { maxWait: 10_000, timeout: 20_000 }));

  return { id: saved.id, slug: saved.slug, status: saved.status, publishedAt: saved.publishedAt, updatedAt: saved.updatedAt, path: postPath(saved.type, saved.slug), seoScore: saved.seoScore };
}

export async function trashPost(id: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const post = await tx.post.update({ where: { id }, data: { status: "TRASHED", trashedAt: new Date() } });
    await recordAudit(tx, { action: "POST_TRASHED", entityType: post.type === "PAGE" ? "Page" : "Post", entityId: id, actorId, metadata: { title: post.title } });
  });
}

/** Restored items come back as drafts, so nothing goes live by accident. */
export async function restorePost(id: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const post = await tx.post.update({ where: { id }, data: { status: "DRAFT", trashedAt: null } });
    await recordAudit(tx, { action: "POST_RESTORED", entityType: post.type === "PAGE" ? "Page" : "Post", entityId: id, actorId, metadata: { title: post.title } });
  });
}

export async function deletePostForever(id: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({ where: { id } });
    check(post, "Already deleted.");
    check(post.status === "TRASHED", "Move it to the trash first.");
    await tx.post.delete({ where: { id } });
    await recordAudit(tx, { action: "POST_DELETED", entityType: post.type === "PAGE" ? "Page" : "Post", entityId: id, actorId, metadata: { title: post.title, slug: post.slug } });
  });
}

/** Copies a saved version back into the post (as a new revision, so it can be undone). */
export async function restoreRevision(revisionId: string, actorId: string) {
  const revision = await prisma.postRevision.findUnique({ where: { id: revisionId }, include: { post: { include: { categories: { select: { id: true } }, tags: { select: { name: true } } } } } });
  check(revision, "That version no longer exists.");
  const p = revision.post;
  return savePost({
    id: p.id, type: p.type, title: revision.title, slug: p.slug, excerpt: revision.excerpt ?? "", contentJson: revision.contentJson, intent: "save",
    featuredImageUrl: p.featuredImageUrl ?? "", featuredImageAlt: p.featuredImageAlt ?? "", categoryIds: p.categories.map((c) => c.id), tags: p.tags.map((t) => t.name),
    productIds: p.productIds, showInFooter: p.showInFooter, seoTitle: p.seoTitle ?? "", seoDescription: p.seoDescription ?? "", focusKeyphrase: p.focusKeyphrase ?? "",
    canonicalUrl: p.canonicalUrl ?? "", noindex: p.noindex, socialImageUrl: p.socialImageUrl ?? "",
  }, actorId);
}

/* ---------------------------------------------------------- categories, tags */

export async function saveBlogCategory(id: string | null, input: { name: string; slug?: string; description?: string }, actorId: string) {
  const name = text(input.name, 60);
  check(name.length >= 2, "Enter the category name.");
  return prisma.$transaction(async (tx) => {
    let slug = slugifyText(text(input.slug, 80) || name) || "category";
    const root = slug;
    for (let i = 2; ; i++) {
      const clash = await tx.blogCategory.findUnique({ where: { slug }, select: { id: true } });
      if (!clash || clash.id === id) break;
      slug = `${root}-${i}`;
    }
    const data = { name, slug, description: text(input.description, 500) || null };
    const category = id ? await tx.blogCategory.update({ where: { id }, data }) : await tx.blogCategory.create({ data });
    await recordAudit(tx, { action: id ? "BLOG_CATEGORY_UPDATED" : "BLOG_CATEGORY_CREATED", entityType: "BlogCategory", entityId: category.id, actorId, metadata: data });
    return category;
  });
}

/** Posts in a deleted category simply lose that category. */
export async function deleteBlogCategory(id: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const category = await tx.blogCategory.delete({ where: { id } });
    await recordAudit(tx, { action: "BLOG_CATEGORY_DELETED", entityType: "BlogCategory", entityId: id, actorId, metadata: { name: category.name } });
  });
}

export async function deleteBlogTag(id: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const tag = await tx.blogTag.delete({ where: { id } });
    await recordAudit(tx, { action: "BLOG_TAG_DELETED", entityType: "BlogTag", entityId: id, actorId, metadata: { name: tag.name } });
  });
}

/* ------------------------------------------------------------------ redirects */

export async function saveRedirect(input: { from: string; to: string; permanent: boolean; note?: string }, actorId: string) {
  const fromPath = normalisePath(input.from);
  const toRaw = input.to.trim();
  check(fromPath !== "/", "Enter the old address, e.g. /old-recipe.");
  check(toRaw.length > 0, "Enter where it should go.");
  const toPath = /^https:\/\//.test(toRaw) ? toRaw : normalisePath(toRaw);
  check(toPath !== fromPath, "The old and new addresses are the same.");
  check(!fromPath.startsWith("/admin") && !fromPath.startsWith("/api") && !fromPath.startsWith("/_next"), "That address can't be redirected.");
  return prisma.$transaction(async (tx) => {
    const loop = await tx.redirect.findUnique({ where: { fromPath: toPath } });
    check(!loop || loop.toPath !== fromPath, "That would send visitors round in a circle.");
    const row = await tx.redirect.upsert({ where: { fromPath }, create: { fromPath, toPath, permanent: input.permanent, note: text(input.note, 200) || null, createdBy: actorId }, update: { toPath, permanent: input.permanent, note: text(input.note, 200) || null } });
    await recordAudit(tx, { action: "REDIRECT_SAVED", entityType: "Redirect", entityId: row.id, actorId, metadata: jsonSafe({ fromPath, toPath, permanent: input.permanent }) });
    return row;
  });
}

export async function deleteRedirect(id: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.redirect.delete({ where: { id } });
    await recordAudit(tx, { action: "REDIRECT_DELETED", entityType: "Redirect", entityId: id, actorId, metadata: { fromPath: row.fromPath, toPath: row.toPath } });
  });
}
