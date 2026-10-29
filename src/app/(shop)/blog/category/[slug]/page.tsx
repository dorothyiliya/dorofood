import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { blogCategories, listPosts } from "@/lib/blog/public";
import { pageMetadata } from "@/lib/seo/site";
import { BlogIndex } from "@/components/blog/blog-index";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const pageOf = (v: unknown) => Math.min(500, Math.max(1, Number.parseInt(typeof v === "string" ? v : "1", 10) || 1));
const find = (slug: string) => (/^[a-z0-9-]{1,80}$/.test(slug) ? prisma.blogCategory.findUnique({ where: { slug } }) : null);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const category = await find(slug);
  if (!category) return { title: "Not found" };
  const page = pageOf(sp.page);
  return pageMetadata({ title: page > 1 ? `${category.name}, page ${page}` : category.name, description: category.description, path: `/blog/category/${slug}${page > 1 ? `?page=${page}` : ""}` });
}

export default async function BlogCategoryPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const category = await find(slug);
  if (!category) notFound();
  const page = pageOf(sp.page);
  const [{ posts, hasNext }, categories] = await Promise.all([listPosts({ page, categorySlug: slug }), blogCategories()]);
  return <BlogIndex title={category.name} description={category.description} posts={posts} categories={categories} activeCategory={slug} page={page} hasNext={hasNext} baseHref={`/blog/category/${slug}`} />;
}
