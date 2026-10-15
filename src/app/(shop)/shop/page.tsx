import type { Metadata } from "next";
import { loadStorefront } from "@/lib/storefront-data";
import { SORTS, ShopBrowser, type SortKey } from "@/components/shop/shop-browser";

export const metadata: Metadata = { title: "Shop groceries" };

export default async function ShopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [data, params] = await Promise.all([loadStorefront(), searchParams]);
  const text = (v: string | string[] | undefined, max = 80) => (typeof v === "string" ? v.slice(0, max) : "");
  const category = data.categories.some((c) => c.slug === params.category) ? text(params.category) : "";
  const sort = (text(params.sort) in SORTS ? text(params.sort) : "featured") as SortKey;
  return <ShopBrowser products={data.products} categories={data.categories} initial={{ category, q: text(params.q), sort }} />;
}
