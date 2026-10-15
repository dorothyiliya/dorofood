import Link from "next/link";
import { formatNaira, type Product } from "@/lib/catalogue";
import { ProductArt } from "@/components/shop/product-art";
import { AddToBag } from "@/components/shop/add-to-bag";

export function Price({ product, large = false }: { product: Product; large?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={`font-semibold tabular-nums text-ink ${large ? "text-3xl" : "text-base"}`}>{formatNaira(product.priceKobo)}</span>
      {product.compareAtKobo && product.compareAtKobo > product.priceKobo && (
        <s className={`tabular-nums text-ink-faint ${large ? "text-lg" : "text-sm"}`} aria-label={`was ${formatNaira(product.compareAtKobo)}`}>{formatNaira(product.compareAtKobo)}</s>
      )}
    </span>
  );
}

export function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  return (
    <article className="group relative flex flex-col">
      <Link href={`/products/${product.slug}`} className="block overflow-hidden rounded-card bg-sunken transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-lift" aria-label={product.name}>
        <div className="aspect-[4/5] transition duration-500 group-hover:scale-[1.03]">
          <ProductArt product={product} priority={priority} />
        </div>
      </Link>
      <div className="mt-3 flex flex-1 flex-col gap-1 px-0.5">
        {product.brand && <p className="text-xs text-ink-soft">{product.brand}</p>}
        <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-ink">
          <Link href={`/products/${product.slug}`} className="hover:underline">{product.name}</Link>
        </h3>
        <p className="text-xs text-ink-faint">{product.size}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <Price product={product} />
          <AddToBag product={product} />
        </div>
      </div>
    </article>
  );
}
