import "server-only";
import { notFound } from "next/navigation";
import type { PostType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EMPTY_DOC, type DocNode } from "@/lib/content/document";
import { getIntegration } from "@/lib/integrations/store";
import { getSetting } from "@/lib/settings";
import { siteOrigin } from "@/lib/seo/site";
import type { EditorPost } from "@/app/admin/_components/editor/post-editor";

/** Everything the editor needs for a new or existing post or page. */
export async function loadEditor(type: PostType, id: string | null) {
  const post = id ? await prisma.post.findUnique({ where: { id }, include: { categories: { select: { id: true } }, tags: { select: { name: true } }, revisions: { orderBy: { createdAt: "desc" }, take: 25 } } }) : null;
  if (id && (!post || post.type !== type || post.status === "TRASHED")) notFound();
  const [categories, others, titlePattern, ai, storage, authors] = await Promise.all([
    type === "POST" ? prisma.blogCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    prisma.post.findMany({ where: { focusKeyphrase: { not: null }, status: { not: "TRASHED" }, ...(id ? { id: { not: id } } : {}) }, select: { focusKeyphrase: true } }),
    getSetting("seo.titleTemplate"),
    getIntegration("nvidia"),
    getIntegration("storage"),
    prisma.staffUser.findMany({ select: { id: true, name: true } }),
  ]);
  const initial: EditorPost = {
    id: post?.id ?? null,
    type,
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    excerpt: post?.excerpt ?? "",
    contentJson: (post?.contentJson as DocNode | undefined) ?? EMPTY_DOC,
    status: post?.status ?? "DRAFT",
    publishedAt: post?.publishedAt?.toISOString() ?? null,
    featuredImageUrl: post?.featuredImageUrl ?? "",
    featuredImageAlt: post?.featuredImageAlt ?? "",
    categoryIds: post?.categories.map((c) => c.id) ?? [],
    tags: post?.tags.map((t) => t.name) ?? [],
    productIds: post?.productIds ?? [],
    showInFooter: post?.showInFooter ?? false,
    updatedAt: post?.updatedAt.toISOString() ?? null,
    focusKeyphrase: post?.focusKeyphrase ?? "",
    seoTitle: post?.seoTitle ?? "",
    seoDescription: post?.seoDescription ?? "",
    noindex: post?.noindex ?? false,
    canonicalUrl: post?.canonicalUrl ?? "",
    socialImageUrl: post?.socialImageUrl ?? "",
  };
  const name = new Map(authors.map((a) => [a.id, a.name]));
  return {
    initial,
    categories,
    revisions: (post?.revisions ?? []).map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), title: r.title, author: (r.authorId && name.get(r.authorId)) || "Someone" })),
    titlePattern,
    siteOrigin: siteOrigin(),
    otherKeyphrases: others.map((o) => o.focusKeyphrase!),
    uploads: storage.active,
    aiReady: ai.active,
  };
}
