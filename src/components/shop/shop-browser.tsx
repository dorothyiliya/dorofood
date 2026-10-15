"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CaretDown, MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import type { CategorySummary, Product } from "@/lib/catalogue";
import { ProductCard } from "@/components/shop/product-card";

export const SORTS = { featured: "Featured", new: "Newest", "price-asc": "Price: low to high", "price-desc": "Price: high to low", name: "Name A to Z" } as const;
export type SortKey = keyof typeof SORTS;

export function ShopBrowser({ products, categories, initial }: { products: Product[]; categories: CategorySummary[]; initial: { category: string; q: string; sort: SortKey } }) {
  const router = useRouter();
  const pathname = usePathname();
  const [category, setCategory] = useState(initial.category);
  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState<SortKey>(initial.sort);

  function sync(next: { category?: string; q?: string; sort?: SortKey }) {
    const state = { category, q, sort, ...next };
    const params = new URLSearchParams();
    if (state.category) params.set("category", state.category);
    if (state.q.trim()) params.set("q", state.q.trim());
    if (state.sort !== "featured") params.set("sort", state.sort);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = products.filter((p) =>
      (!category || p.categorySlug === category)
      && (!needle || `${p.name} ${p.brand} ${p.category} ${p.description} ${p.size}`.toLowerCase().includes(needle)));
    const sorted = [...list];
    if (sort === "new") sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    if (sort === "price-asc") sorted.sort((a, b) => a.priceKobo - b.priceKobo);
    if (sort === "price-desc") sorted.sort((a, b) => b.priceKobo - a.priceKobo);
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    // Featured: in stock first, then the catalogue order.
    if (sort === "featured") sorted.sort((a, b) => Number(b.available) - Number(a.available));
    return sorted;
  }, [products, category, q, sort]);

  const current = categories.find((c) => c.slug === category);
  const chip = (active: boolean) => `whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-ink text-canvas" : "bg-surface text-ink-soft ring-1 ring-line hover:text-ink"}`;

  return (
    <div className="mx-auto max-w-shop px-4 pb-8 pt-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{current?.name ?? "All groceries"}</h1>
          <p className="mt-2 text-ink-soft" aria-live="polite">{visible.length} product{visible.length === 1 ? "" : "s"}{q.trim() ? ` matching "${q.trim()}"` : ""}</p>
        </div>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          <div className="relative flex-1 sm:w-72 sm:flex-none">
            <label htmlFor="shop-filter" className="sr-only">Filter products</label>
            <MagnifyingGlass size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
            <input id="shop-filter" type="search" value={q} onChange={(e) => { setQ(e.target.value); sync({ q: e.target.value }); }} placeholder="Filter this aisle"
              className="h-11 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-[15px] placeholder:text-ink-faint focus:border-leaf focus:outline-none focus:ring-4 focus:ring-leaf/15" />
          </div>
          <label className="relative">
            <span className="sr-only">Sort by</span>
            <select value={sort} onChange={(e) => { const s = e.target.value as SortKey; setSort(s); sync({ sort: s }); }}
              className="h-11 cursor-pointer appearance-none rounded-full border border-line bg-surface pl-4 pr-10 text-sm font-medium focus:border-leaf focus:outline-none focus:ring-4 focus:ring-leaf/15">
              {Object.entries(SORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <CaretDown size={14} weight="bold" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
          </label>
        </div>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Aisles" className="lg:sticky lg:top-40 lg:self-start">
          <ul className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
            <li><button type="button" onClick={() => { setCategory(""); sync({ category: "" }); }} aria-pressed={!category} className={`${chip(!category)} lg:w-full lg:text-left`}>All groceries <span className="ml-1 opacity-60">{products.length}</span></button></li>
            {categories.map((c) => (
              <li key={c.slug}>
                <button type="button" onClick={() => { setCategory(c.slug); sync({ category: c.slug }); }} aria-pressed={category === c.slug} className={`${chip(category === c.slug)} lg:w-full lg:text-left`}>
                  {c.name} <span className="ml-1 opacity-60">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center rounded-card border border-dashed border-line px-6 py-20 text-center">
            <p className="font-display text-2xl font-semibold">Nothing matches that yet</p>
            <p className="mt-2 max-w-sm text-ink-soft">Try a different word, or browse every aisle.</p>
            <button type="button" onClick={() => { setQ(""); setCategory(""); sync({ q: "", category: "" }); }} className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-ink hover:bg-primary-hover">
              <X size={16} aria-hidden="true" /> Clear filters
            </button>
          </div>
        ) : (
          <section aria-labelledby="results-heading">
            <h2 id="results-heading" className="sr-only">Products</h2>
            <ul className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((p, i) => <li key={p.id}><ProductCard product={p} priority={i < 4} /></li>)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
