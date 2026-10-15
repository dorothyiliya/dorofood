"use client";

import { useEffect, useState } from "react";
import { Check, Plus } from "@phosphor-icons/react/dist/ssr";
import type { Product } from "@/lib/catalogue";
import { useShop } from "@/components/shop/shop-provider";

/** One add-to-bag control with every state: available, added, sold out, not shippable to the chosen market. */
export function AddToBag({ product, quantity = 1, size = "sm", onAdded }: { product: Product; quantity?: number; size?: "sm" | "lg"; onAdded?: () => void }) {
  const { add, canShip, market } = useShop();
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => setAdded(false), 1400);
    return () => window.clearTimeout(t);
  }, [added]);

  const base = size === "lg"
    ? "h-12 w-full gap-2 px-6 text-base"
    : "h-9 gap-1.5 px-3.5 text-sm";

  if (!product.available) {
    return <span className={`inline-flex items-center justify-center rounded-full bg-sunken font-medium text-ink-soft ${base}`}>Sold out</span>;
  }
  if (!canShip(product)) {
    return <span className={`inline-flex items-center justify-center rounded-full border border-line text-center font-medium text-ink-soft ${size === "lg" ? base : "h-9 px-3 text-xs"}`}>Not sold in {market.name}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => { if (add(product.id, quantity)) { setAdded(true); onAdded?.(); } }}
      aria-label={size === "sm" ? `Add ${product.name} to bag` : undefined}
      className={`inline-flex items-center justify-center rounded-full bg-primary font-semibold text-primary-ink transition duration-200 hover:bg-primary-hover active:scale-[0.97] ${base}`}
    >
      {added ? <Check size={size === "lg" ? 20 : 16} weight="bold" aria-hidden="true" /> : <Plus size={size === "lg" ? 20 : 16} weight="bold" aria-hidden="true" />}
      <span>{added ? "Added" : size === "lg" ? "Add to bag" : "Add"}</span>
    </button>
  );
}
