import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { blogCategories, listPosts } from "@/lib/blog/public";
import { pageMetadata } from "@/lib/seo/site";
import { BlogIndex } from "@/components/blog/blog-index";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const pageOf = (v: unknown) => Math.min(500, Math.max(1, Number.parseInt(typeof v === "string" ? v : "1", 10) || 1));
const find = (slug: string) => (/^[a-z0-9-]{1,80}$/.test(slug) ? prisma.blogTag.findUnique({ where: { slug } }) : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = await find((await params).slug);
  if (!tag) return { title: "Not found" };
  // Tag pages mostly repeat other pages, so they are kept out of Google.
  return pageMetadata({ title: `Posts tagged ${tag.name}`, path: `/blog/tag/${tag.slug}`, noindex: true });
}

export default async function BlogTagPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const tag = await find(slug);
  if (!tag) notFound();
  const page = pageOf(sp.page);
  const [{ posts, hasNext }, categories] = await Promise.all([listPosts({ page, tagSlug: slug }), blogCategories()]);
  return <BlogIndex title={`#${tag.name}`} posts={posts} categories={categories} page={page} hasNext={hasNext} baseHref={`/blog/tag/${slug}`} />;
}
