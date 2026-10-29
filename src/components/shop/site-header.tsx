"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { MagnifyingGlass, MapPin, Tote, X } from "@phosphor-icons/react/dist/ssr";
import type { CategorySummary } from "@/lib/catalogue";
import { BRAND } from "@/lib/brand";
import { useShop } from "@/components/shop/shop-provider";

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <picture>
      <source srcSet={BRAND.mark.dark} media="(prefers-color-scheme: dark)" />
      <img src={BRAND.mark.light} alt="" width={size} height={size} className="shrink-0" />
    </picture>
  );
}

function SearchForm({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    router.push(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : "/shop");
    onDone?.();
  }

  return (
    <form role="search" onSubmit={submit} className="relative w-full">
      <label htmlFor="site-search" className="sr-only">Search groceries</label>
      <MagnifyingGlass size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
      <input
        id="site-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus}
        placeholder="Search plantain chips, pepper, oats…"
        className="h-11 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-[15px] text-ink placeholder:text-ink-faint focus:border-leaf focus:outline-none focus:ring-4 focus:ring-leaf/15"
      />
    </form>
  );
}

export function SiteHeader({ announcement, categories }: { announcement: string; categories: CategorySummary[] }) {
  const { count, openBag, markets, market, setMarket } = useShop();
  const [searchOpen, setSearchOpen] = useState(false);
  const [bump, setBump] = useState(false);

  useEffect(() => {
    if (count === 0) return;
    setBump(true);
    const t = window.setTimeout(() => setBump(false), 450);
    return () => window.clearTimeout(t);
  }, [count]);

  return (
    <>
      <div className="bg-brand-900 text-brand-50">
        <div className="mx-auto flex max-w-shop items-center justify-between gap-4 px-4 py-2 text-xs sm:px-6">
          <p className="min-w-0 truncate font-medium">{announcement}</p>
          <label className="flex shrink-0 items-center gap-1.5">
            <MapPin size={14} weight="fill" aria-hidden="true" />
            <span className="hidden sm:inline">Deliver to</span>
            <select value={market.code} onChange={(e) => setMarket(e.target.value)} aria-label="Deliver to" className="cursor-pointer rounded bg-transparent font-semibold focus:outline-none">
              {markets.map((m) => <option key={m.code} value={m.code} className="text-ink">{m.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
        <div className="mx-auto flex h-16 max-w-shop items-center gap-4 px-4 sm:px-6 lg:h-[72px] lg:gap-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label={`${BRAND.name} home`}>
            <BrandMark size={38} />
            <span className="font-display text-lg font-bold leading-none tracking-tight text-ink sm:text-xl">{BRAND.name}</span>
          </Link>
          <div className="hidden flex-1 md:block md:max-w-xl"><SearchForm /></div>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setSearchOpen((v) => !v)} className="grid h-11 w-11 place-items-center rounded-full text-ink hover:bg-sunken md:hidden" aria-label={searchOpen ? "Close search" : "Search"} aria-expanded={searchOpen}>
              {searchOpen ? <X size={20} aria-hidden="true" /> : <MagnifyingGlass size={20} aria-hidden="true" />}
            </button>
            <button type="button" onClick={openBag} className="relative inline-flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-semibold text-ink ring-1 ring-line transition hover:ring-ink/30" aria-label={`Open bag, ${count} item${count === 1 ? "" : "s"}`}>
              <Tote size={20} weight="duotone" aria-hidden="true" />
              <span className="hidden sm:inline">Bag</span>
              <span className={`grid h-6 min-w-6 place-items-center rounded-full bg-gold px-1.5 text-xs font-bold text-gold-ink tabular-nums ${bump ? "animate-bump" : ""}`}>{count}</span>
            </button>
          </div>
        </div>
        {searchOpen && <div className="px-4 pb-3 md:hidden"><SearchForm autoFocus onDone={() => setSearchOpen(false)} /></div>}
        <Suspense fallback={<CategoryNav categories={categories} active={null} />}>
          <ActiveCategoryNav categories={categories} />
        </Suspense>
      </header>
    </>
  );
}

/** Reads the current aisle from the URL; isolated so the rest of the page can still render statically. */
function ActiveCategoryNav({ categories }: { categories: CategorySummary[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return <CategoryNav categories={categories} active={pathname === "/shop" ? params.get("category") ?? "" : null} blog={pathname === "/blog" || pathname.startsWith("/blog/")} />;
}

function CategoryNav({ categories, active, blog = false }: { categories: CategorySummary[]; active: string | null; blog?: boolean }) {
  return (
    <nav aria-label="Categories" className="mx-auto max-w-shop">
      <ul className="scrollbar-none flex gap-1 overflow-x-auto px-4 pb-2.5 sm:px-6">
        <li><NavPill href="/shop" active={active === ""}>All groceries</NavPill></li>
        {categories.map((c) => (
          <li key={c.slug}><NavPill href={`/shop?category=${c.slug}`} active={active === c.slug}>{c.name}</NavPill></li>
        ))}
        <li className="ml-auto border-l border-line pl-1"><NavPill href="/blog" active={blog}>Blog</NavPill></li>
      </ul>
    </nav>
  );
}

function NavPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`block whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${active ? "bg-ink text-canvas" : "text-ink-soft hover:bg-sunken hover:text-ink"}`}>
      {children}
    </Link>
  );
}
