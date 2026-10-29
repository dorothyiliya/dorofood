import type { Metadata } from "next";
import { loadStorefront } from "@/lib/storefront-data";
import { pageMetadata } from "@/lib/seo/site";
import { SORTS, ShopBrowser, type SortKey } from "@/components/shop/shop-browser";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const [data, params] = await Promise.all([loadStorefront(), searchParams]);
  const category = data.categories.find((c) => c.slug === params.category);
  return pageMetadata({
    title: category ? `${category.name}: Nigerian groceries` : "Shop Nigerian groceries online",
    path: category ? `/shop?category=${category.slug}` : "/shop",
    // Searches and sorted views repeat the same products.
    noindex: typeof params.q === "string" || typeof params.sort === "string",
  });
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [data, params] = await Promise.all([loadStorefront(), searchParams]);
  const text = (v: string | string[] | undefined, max = 80) => (typeof v === "string" ? v.slice(0, max) : "");
  const category = data.categories.some((c) => c.slug === params.category) ? text(params.category) : "";
  const sort = (text(params.sort) in SORTS ? text(params.sort) : "featured") as SortKey;
  return <ShopBrowser products={data.products} categories={data.categories} initial={{ category, q: text(params.q), sort }} />;
}
