import Link from "next/link";
import { ArrowRight, Globe, Package, Truck } from "@phosphor-icons/react/dist/ssr";
import { BRAND } from "@/lib/brand";
import { formatPrice, type CategorySummary, type Product } from "@/lib/catalogue";
import { loadStorefront, type MarketSummary } from "@/lib/storefront-data";
import { CategoryGlyph, ProductArt } from "@/components/shop/product-art";
import { ProductCard } from "@/components/shop/product-card";
import { ProductRail } from "@/components/shop/product-rail";

export default async function HomePage() {
  const data = await loadStorefront();
  const products = data.products;
  const newest = [...products].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 10);
  const spotlight = data.categories.find((c) => c.count >= 2);

  return (
    <>
      <Hero products={products} />
      <HowItWorks paymentWindowMinutes={data.paymentWindowMinutes} />
      {data.categories.length > 0 && <Aisles categories={data.categories} />}
      {newest.length > 0 && <NewArrivals products={newest} />}
      {spotlight && <Spotlight category={spotlight} products={products.filter((p) => p.categorySlug === spotlight.slug).slice(0, 4)} />}
      <Delivery markets={data.markets} homeMarket={data.homeMarket} contactEmail={data.contactEmail} />
      <Story />
    </>
  );
}

const container = "mx-auto max-w-shop px-4 sm:px-6";

function Hero({ products }: { products: Product[] }) {
  // Packs in the panel's own greens would disappear into it, so prefer contrasting colourways.
  const dark = new Set(["#123c2a", "#2f6b5e"]);
  const ranked = [...products.filter((p) => p.available)].sort((a, b) => Number(dark.has(a.pack.color)) - Number(dark.has(b.pack.color)));
  const shelf = ranked.slice(0, 3);
  return (
    <section className={`${container} grid items-center gap-10 pb-16 pt-10 md:pt-14 lg:grid-cols-[1.15fr_1fr] lg:gap-14 lg:pb-24`}>
      <div>
        <h1 className="font-display text-[2.6rem] font-bold leading-[1.04] tracking-tight text-ink [text-wrap:balance] sm:text-[3.2rem] lg:text-[2.9rem] xl:text-[3.25rem]">
          Nigerian groceries, without the market run.
        </h1>
        <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-ink-soft">
          Snacks, drinks, spices and breakfast staples from brands you know, priced in naira with delivery shown before you pay.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/shop" className="group inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-ink transition hover:bg-primary-hover active:scale-[0.98]">
            Shop groceries <ArrowRight size={18} weight="bold" className="transition group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <Link href="#delivery" className="inline-flex h-12 items-center rounded-full border border-line bg-surface px-6 text-base font-semibold text-ink transition hover:border-ink/30">
            Delivery info
          </Link>
        </div>
      </div>

      {/* The shelf: real catalogue products on a panel drawn from the logo (sun over striped fields). */}
      <div className="relative mx-auto aspect-[5/4] w-full max-w-[620px] overflow-hidden rounded-[2rem] shadow-float" style={{ background: "linear-gradient(160deg, #123c2a 0%, #0b4628 55%, #06542a 100%)" }}>
        <div className="absolute left-1/2 top-[14%] h-[34%] w-[27%] -translate-x-1/2 rounded-full bg-[#66a218]/80 blur-[1px]" aria-hidden="true" />
        <div className="absolute -bottom-[18%] -left-[10%] h-[46%] w-[120%] rotate-[-4deg] rounded-[50%] bg-[#66a218]/35" aria-hidden="true" />
        <div className="absolute -bottom-[26%] -left-[6%] h-[44%] w-[80%] rotate-[-7deg] rounded-[50%] bg-[#e4ba0c]/55" aria-hidden="true" />
        <div className="absolute -bottom-[30%] left-[38%] h-[42%] w-[80%] rotate-[5deg] rounded-[50%] bg-[#66a218]/55" aria-hidden="true" />
        <div className="absolute inset-0 flex items-end justify-center px-[6%] pb-[8%]">
          {shelf.map((p, i) => (
            <Link key={p.id} href={`/products/${p.slug}`} aria-label={p.name}
              className={`block animate-rise transition duration-300 hover:-translate-y-2 ${i === 1 ? "z-10 -mx-[3%] mb-[4%] w-[37%]" : "w-[31%]"} ${i === 0 ? "-rotate-[7deg]" : i === 2 ? "rotate-[7deg]" : ""}`}
              style={{ animationDelay: `${120 + i * 110}ms` }}>
              <ProductArt product={p} size="shelf" priority />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks({ paymentWindowMinutes }: { paymentWindowMinutes: number }) {
  const items = [
    { Icon: Truck, title: "Delivery priced upfront", body: "A fixed fee per order, shown before you pay." },
    { Icon: Package, title: "Stock held while you pay", body: `Items in your checkout are reserved for ${paymentWindowMinutes} minutes.` },
    { Icon: Globe, title: "Export-checked abroad", body: "Orders outside Nigeria are checked before they ship." },
  ];
  return (
    <section aria-label="How ordering works" className="border-y border-line bg-surface">
      <ul className={`${container} grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-y-0 sm:divide-x`}>
        {items.map(({ Icon, title, body }) => (
          <li key={title} className="flex gap-3.5 py-6 lg:px-6 lg:first:pl-0">
            <Icon size={26} weight="duotone" className="mt-0.5 shrink-0 text-leaf" aria-hidden="true" />
            <div>
              <p className="font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TINTS = ["bg-leaf-soft", "bg-gold-soft", "bg-sunken"];

function Aisles({ categories }: { categories: CategorySummary[] }) {
  // Bento only when the count fits it exactly (1 large + 4 small); otherwise an even grid.
  const bento = categories.length === 5;
  return (
    <section className={`${container} pt-20`}>
      <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Shop by aisle</h2>
      <ul className={`mt-8 grid gap-4 ${bento ? "grid-cols-2 lg:grid-cols-4 lg:grid-rows-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
        {categories.map((c, i) => {
          const big = bento && i === 0;
          return (
            <li key={c.slug} className={big ? "col-span-2 lg:row-span-2" : ""}>
              <Link href={`/shop?category=${c.slug}`} className={`group relative flex h-full flex-col justify-between overflow-hidden rounded-card p-5 transition hover:-translate-y-0.5 hover:shadow-lift ${big ? "min-h-[220px] bg-brand-900 text-brand-50 lg:min-h-[340px] lg:p-8" : `min-h-[150px] ${TINTS[i % TINTS.length]} text-ink`}`}>
                <CategoryGlyph icon={c.icon} size={big ? 64 : 40} className={big ? "text-[#e4ba0c]" : "text-leaf"} />
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className={`font-display font-bold ${big ? "text-3xl lg:text-4xl" : "text-lg"}`}>{c.name}</p>
                    <p className={`text-sm ${big ? "opacity-80" : "text-ink-soft"}`}>{c.count} product{c.count === 1 ? "" : "s"}</p>
                  </div>
                  <ArrowRight size={big ? 24 : 18} className="transition group-hover:translate-x-1" aria-hidden="true" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NewArrivals({ products }: { products: Product[] }) {
  return (
    <section className="pt-20">
      <div className="bg-gold-soft">
        <div className={`${container} flex items-center justify-between gap-4 py-5`}>
          <h2 className="font-display text-2xl font-bold tracking-tight text-gold-ink sm:text-3xl">New on the shelf</h2>
          <Link href="/shop?sort=new" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-ink hover:underline">See everything <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </div>
      <div className={`${container} pt-8`}><ProductRail products={products} label="New on the shelf" /></div>
    </section>
  );
}

function Spotlight({ category, products }: { category: CategorySummary; products: Product[] }) {
  return (
    <section className={`${container} pt-20`}>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.6fr]">
        <Link href={`/shop?category=${category.slug}`} className="group relative flex min-h-[280px] flex-col justify-between overflow-hidden rounded-card bg-leaf-soft p-8">
          <CategoryGlyph icon={category.icon} size={84} className="text-leaf" />
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Stock up on {category.name.toLowerCase()}</h2>
            <p className="mt-2 text-ink-soft">{category.count} products in this aisle, delivered together in one order.</p>
            <span className="mt-5 inline-flex items-center gap-2 font-semibold">Shop {category.name.toLowerCase()} <ArrowRight size={18} className="transition group-hover:translate-x-1" aria-hidden="true" /></span>
          </div>
        </Link>
        <ul className={`grid grid-cols-2 gap-5 lg:grid-cols-2 ${{ 2: "md:grid-cols-2 xl:grid-cols-2", 3: "md:grid-cols-3 xl:grid-cols-3", 4: "md:grid-cols-4 xl:grid-cols-4" }[products.length] ?? "md:grid-cols-4 xl:grid-cols-4"}`}>
          {products.map((p) => <li key={p.id}><ProductCard product={p} /></li>)}
        </ul>
      </div>
    </section>
  );
}

function Delivery({ markets, homeMarket, contactEmail }: { markets: MarketSummary[]; homeMarket: string; contactEmail: string }) {
  const homeCountry = markets.find((m) => m.code === homeMarket)?.countryCode ?? "NG";
  return (
    <section id="delivery" className={`${container} scroll-mt-32 pt-24`}>
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Delivery, in plain terms</h2>
          <p className="mt-4 max-w-[52ch] leading-relaxed text-ink-soft">
            Choose where your order is going from the bar at the top of the page. Each destination has one fixed delivery fee per order, added before you pay. Orders outside Nigeria only include items cleared for export to that country.
          </p>
          <a href={`mailto:${contactEmail}?subject=Delivery%20question`} className="mt-6 inline-flex items-center gap-2 font-semibold text-ink underline decoration-leaf decoration-2 underline-offset-4 hover:decoration-ink">Ask about another country</a>
        </div>
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {markets.map((m) => (
            <li key={m.code} className="flex items-center justify-between gap-4 px-6 py-5">
              <div className="flex items-center gap-4">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-sunken text-xs font-bold tracking-wide">{m.countries.length > 1 ? <Globe size={18} aria-hidden="true" /> : m.countryCode}</span>
                <div>
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-sm text-ink-soft">{m.countryCode === homeCountry ? `Nationwide orders, priced in ${m.currency}` : `Export-cleared items only, priced in ${m.currency}`}</p>
                </div>
              </div>
              {m.delivers && m.flatRateMinor
                ? <p className="text-right text-sm"><span className="font-semibold tabular-nums">{m.countries.length > 1 ? "From " : ""}{formatPrice(m.countries.length > 1 ? Math.min(...m.countries.map((c) => Number(c.flatRateMinor))) : Number(m.flatRateMinor), m.currency)}</span><span className="block text-ink-soft">per order</span></p>
                : <p className="rounded-full bg-sunken px-3 py-1 text-sm font-medium text-ink-soft">Not yet available</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Story() {
  return (
    <section className={`${container} pt-24`}>
      <div className="grid items-center gap-8 overflow-hidden rounded-[2rem] bg-leaf-soft px-6 py-12 sm:px-12 md:grid-cols-[auto_1fr] md:gap-14 md:py-16">
        <picture>
          <source srcSet={BRAND.mark.dark} media="(prefers-color-scheme: dark)" />
          <img src={BRAND.mark.light} alt={`${BRAND.name} logo`} width={180} height={180} className="h-32 w-32 md:h-44 md:w-44" loading="lazy" />
        </picture>
        <div>
          <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{BRAND.tagline}</h2>
          <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-ink-soft">
            {BRAND.name} puts Nigerian pantry staples, snacks and drinks in one well-organised shop, with clear prices, real stock levels and delivery costs you can see before you pay.
          </p>
        </div>
      </div>
    </section>
  );
}
