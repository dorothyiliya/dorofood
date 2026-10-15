"use client";

import { useRef } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import type { Product } from "@/lib/catalogue";
import { ProductCard } from "@/components/shop/product-card";

/** Horizontal, scroll-snapping row of products. Touch and trackpad scroll natively; buttons help mouse users. */
export function ProductRail({ products, label }: { products: Product[]; label: string }) {
  const track = useRef<HTMLUListElement>(null);
  const step = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8, behavior: "smooth" });
  const button = "hidden h-11 w-11 place-items-center rounded-full border border-line bg-surface text-ink shadow-lift transition hover:border-ink/30 md:grid";
  return (
    <div className="relative">
      <ul ref={track} aria-label={label} className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-4 px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6">
        {products.map((p) => (
          <li key={p.id} className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[23%] xl:w-[19%]"><ProductCard product={p} /></li>
        ))}
      </ul>
      {products.length > 4 && (
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={button} onClick={() => step(-1)} aria-label={`Scroll ${label} back`}><CaretLeft size={18} aria-hidden="true" /></button>
          <button type="button" className={button} onClick={() => step(1)} aria-label={`Scroll ${label} forward`}><CaretRight size={18} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}
