import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { loadProduct } from "@/lib/storefront-data";
import { ProductArt } from "@/components/shop/product-art";
import { Price, SavingBadge } from "@/components/shop/price";
import { ProductPurchase } from "@/components/shop/product-purchase";
import { ProductRail } from "@/components/shop/product-rail";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { product } = await loadProduct((await params).slug);
  if (!product) return { title: "Product not found" };
  return {
    title: product.name,
    description: `${product.name}, ${product.size}. ${product.description}`.slice(0, 160),
    openGraph: product.images[0] ? { images: [{ url: product.images[0].url, alt: product.images[0].alt }] } : undefined,
  };
}

export default async function ProductPage({ params }: Params) {
  const { data, product } = await loadProduct((await params).slug);
  if (!product) notFound();
  const related = data.products.filter((p) => p.categorySlug === product.categorySlug && p.id !== product.id).slice(0, 10);

  return (
    <div className="mx-auto max-w-shop px-4 pt-6 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="hover:text-ink">Home</Link></li>
          <li aria-hidden="true"><CaretRight size={12} /></li>
          <li><Link href={`/shop?category=${product.categorySlug}`} className="hover:text-ink">{product.category}</Link></li>
          <li aria-hidden="true"><CaretRight size={12} /></li>
          <li aria-current="page" className="truncate text-ink">{product.name}</li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div className="space-y-3">
          <div className="aspect-square overflow-hidden rounded-[2rem] bg-sunken"><ProductArt product={product} size="page" priority /></div>
          {product.images.length > 1 && (
            <ul className="grid grid-cols-4 gap-3">
              {product.images.slice(1, 5).map((img) => (
                <li key={img.url} className="aspect-square overflow-hidden rounded-xl bg-sunken">
                  {/* eslint-disable-next-line @next/next/no-img-element -- staff-supplied image URL */}
                  <img src={img.url} alt={img.alt || product.name} loading="lazy" className="h-full w-full object-cover" />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:pt-4">
          {product.brand && <p className="text-sm font-medium text-ink-soft">{product.brand}</p>}
          <h1 className="mt-1 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">{product.name}</h1>
          <p className="mt-2 text-ink-soft">{product.size}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Price product={product} large />
            <SavingBadge product={product} />
          </div>
          <p className={`mt-2 text-sm font-medium ${product.available ? "text-leaf-ink" : "text-danger"}`}>{product.available ? "In stock" : "Sold out for now"}</p>
          <div className="mt-8"><ProductPurchase product={product} /></div>
          <div className="mt-10 border-t border-line pt-8">
            <h2 className="font-semibold">About this product</h2>
            <p className="mt-3 max-w-[60ch] leading-relaxed text-ink-soft">{product.description}</p>
            <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-ink-faint">Aisle</dt><dd className="mt-0.5 font-medium">{product.category}</dd></div>
              <div><dt className="text-ink-faint">Pack size</dt><dd className="mt-0.5 font-medium">{product.size}</dd></div>
              <div><dt className="text-ink-faint">Made in</dt><dd className="mt-0.5 font-medium">{product.origin === "NG" ? "Nigeria" : product.origin}</dd></div>
            </dl>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="pt-24">
          <h2 className="mb-8 font-display text-3xl font-bold tracking-tight">More from {product.category.toLowerCase()}</h2>
          <ProductRail products={related} label={`More ${product.category}`} />
        </section>
      )}
    </div>
  );
}
