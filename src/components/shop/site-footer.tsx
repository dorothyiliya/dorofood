import Link from "next/link";
import { BRAND } from "@/lib/brand";
import type { CategorySummary } from "@/lib/catalogue";
import { BrandMark } from "@/components/shop/site-header";

export function SiteFooter({ categories, contactEmail, pages = [] }: { categories: CategorySummary[]; contactEmail: string; pages?: { title: string; slug: string }[] }) {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-shop gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <BrandMark size={40} />
            <span className="font-display text-xl font-bold">{BRAND.name}</span>
          </div>
          <p className="mt-2 font-display text-sm font-semibold text-leaf-ink">{BRAND.tagline}</p>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">{BRAND.description}</p>
        </div>
        <nav aria-label="Shop">
          <h2 className="text-sm font-semibold">Shop</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-soft">
            <li><Link href="/shop" className="hover:text-ink">All groceries</Link></li>
            {categories.slice(0, 6).map((c) => <li key={c.slug}><Link href={`/shop?category=${c.slug}`} className="hover:text-ink">{c.name}</Link></li>)}
          </ul>
        </nav>
        <nav aria-label="Help">
          <h2 className="text-sm font-semibold">Help</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-soft">
            <li><Link href="/#delivery" className="hover:text-ink">Delivery and shipping</Link></li>
            <li><Link href="/blog" className="hover:text-ink">Blog and recipes</Link></li>
            {pages.map((p) => <li key={p.slug}><Link href={`/${p.slug}`} className="hover:text-ink">{p.title}</Link></li>)}
            <li><a href={`mailto:${contactEmail}`} className="hover:text-ink">{contactEmail}</a></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-shop flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-ink-faint sm:px-6">
          <p>© {new Date().getFullYear()} {BRAND.name}. Prices in the currency of your delivery market.</p>
        </div>
      </div>
    </footer>
  );
}
