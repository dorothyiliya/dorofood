"use client";

import { formatPrice, type Product } from "@/lib/catalogue";
import { useShop } from "@/components/shop/shop-provider";

/** The price in the shopper's market; products not sold there show the home (naira) price. */
function usePrice(product: Product) {
  const { priceOf } = useShop();
  return priceOf(product) ?? { minor: product.priceKobo, compareAt: product.compareAtKobo, currency: "NGN" };
}

export function Price({ product, large = false }: { product: Product; large?: boolean }) {
  const price = usePrice(product);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className={`font-semibold tabular-nums text-ink ${large ? "text-3xl" : "text-base"}`}>{formatPrice(price.minor, price.currency)}</span>
      {price.compareAt && price.compareAt > price.minor && (
        <s className={`tabular-nums text-ink-faint ${large ? "text-lg" : "text-sm"}`} aria-label={`was ${formatPrice(price.compareAt, price.currency)}`}>{formatPrice(price.compareAt, price.currency)}</s>
      )}
    </span>
  );
}

export function SavingBadge({ product }: { product: Product }) {
  const price = usePrice(product);
  const saving = price.compareAt && price.compareAt > price.minor ? price.compareAt - price.minor : 0;
  if (saving <= 0) return null;
  return <span className="rounded-full bg-gold-soft px-3 py-1 text-sm font-semibold text-gold-ink">Save {formatPrice(saving, price.currency)}</span>;
}
