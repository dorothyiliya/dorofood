import type { Metadata } from "next";
import { blogCategories, listPosts } from "@/lib/blog/public";
import { pageMetadata, seoSettings } from "@/lib/seo/site";
import { BlogIndex } from "@/components/blog/blog-index";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const pageOf = (v: unknown) => Math.min(500, Math.max(1, Number.parseInt(typeof v === "string" ? v : "1", 10) || 1));

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const page = pageOf(params.page);
  const seo = await seoSettings();
  return pageMetadata({ title: page > 1 ? `${seo.blogTitle}, page ${page}` : seo.blogTitle, description: seo.blogDescription, path: page > 1 ? `/blog?page=${page}` : "/blog", noindex: typeof params.q === "string" });
}

export default async function BlogPage({ searchParams }: Props) {
  const params = await searchParams;
  const page = pageOf(params.page);
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const [{ posts, hasNext }, categories, seo] = await Promise.all([listPosts({ page, q: q || undefined }), blogCategories(), seoSettings()]);
  return <BlogIndex title={q ? `Search: ${q}` : seo.blogTitle} description={q ? null : seo.blogDescription} posts={posts} categories={categories} page={page} hasNext={hasNext} baseHref="/blog" q={q || undefined} featured={page === 1 && !q} />;
}
