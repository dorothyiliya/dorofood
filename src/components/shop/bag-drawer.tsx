"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Minus, Plus, Tote, Trash, X } from "@phosphor-icons/react/dist/ssr";
import { formatPrice } from "@/lib/catalogue";
import { ProductArt } from "@/components/shop/product-art";
import { MAX_QUANTITY, useShop } from "@/components/shop/shop-provider";

export function QuantityStepper({ value, onChange, label, max = MAX_QUANTITY }: { value: number; onChange: (n: number) => void; label: string; max?: number }) {
  const btn = "grid h-9 w-9 place-items-center rounded-full text-ink transition hover:bg-sunken disabled:opacity-40";
  return (
    <div className="inline-flex items-center rounded-full border border-line bg-surface" role="group" aria-label={`Quantity for ${label}`}>
      <button type="button" className={btn} onClick={() => onChange(value - 1)} aria-label="Decrease quantity"><Minus size={14} weight="bold" aria-hidden="true" /></button>
      <span className="w-7 text-center text-sm font-semibold tabular-nums" aria-live="polite">{value}</span>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity"><Plus size={14} weight="bold" aria-hidden="true" /></button>
    </div>
  );
}

export function BagDrawer() {
  const { bagOpen, closeBag, lines, count, subtotalMinor, priceOf, setQuantity, checkoutLive, canShip, market } = useShop();
  const closeRef = useRef<HTMLButtonElement>(null);
  const unshippable = lines.filter((l) => !canShip(l.product));

  useEffect(() => {
    if (!bagOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeBag(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [bagOpen, closeBag]);

  if (!bagOpen) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your bag">
      <button type="button" className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={closeBag} aria-label="Close bag" tabIndex={-1} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md animate-slidein flex-col bg-canvas shadow-float">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-xl font-semibold">Your bag <span className="text-base font-normal text-ink-soft">({count})</span></h2>
          <button ref={closeRef} type="button" onClick={closeBag} className="grid h-10 w-10 place-items-center rounded-full hover:bg-sunken" aria-label="Close bag"><X size={20} aria-hidden="true" /></button>
        </header>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-leaf-soft text-leaf"><Tote size={30} weight="duotone" aria-hidden="true" /></span>
            <div>
              <p className="font-display text-lg font-semibold">Your bag is empty</p>
              <p className="mt-1 text-sm text-ink-soft">Add a few groceries and they will wait here, even if you close the page.</p>
            </div>
            <Link href="/shop" onClick={closeBag} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-ink hover:bg-primary-hover">Browse groceries</Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-line overflow-y-auto px-5">
              {lines.map(({ product, quantity }) => (
                <li key={product.id} className="flex gap-4 py-4">
                  <Link href={`/products/${product.slug}`} onClick={closeBag} className="h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-sunken"><ProductArt product={product} size="thumb" /></Link>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/products/${product.slug}`} onClick={closeBag} className="line-clamp-2 text-sm font-medium hover:underline">{product.name}</Link>
                        <p className="text-xs text-ink-faint">{product.size}</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">{(() => { const price = priceOf(product); return price ? formatPrice(price.minor * quantity, price.currency) : "–"; })()}</p>
                    </div>
                    {!canShip(product) && <p className="mt-1 text-xs text-danger">Not sold in {market.name}</p>}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <QuantityStepper value={quantity} onChange={(n) => setQuantity(product.id, n)} label={product.name} />
                      <button type="button" onClick={() => setQuantity(product.id, 0)} className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-danger"><Trash size={14} aria-hidden="true" /> Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <footer className="space-y-3 border-t border-line bg-surface px-5 py-5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink-soft">Subtotal</span>
                <span className="text-xl font-semibold tabular-nums">{formatPrice(subtotalMinor, market.currency)}</span>
              </div>
              <p className="text-xs text-ink-soft">Delivery is added at checkout, before you pay.</p>
              {checkoutLive ? (
                unshippable.length > 0
                  ? <p className="rounded-xl bg-gold-soft px-3 py-2 text-sm text-gold-ink">Remove items not sold in {market.name} to continue.</p>
                  : <Link href="/checkout" onClick={closeBag} className="flex h-12 w-full items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-ink hover:bg-primary-hover">Checkout</Link>
              ) : (
                <div className="rounded-xl bg-sunken px-4 py-3 text-center text-sm">
                  <p className="font-semibold">Online checkout opens soon</p>
                  <p className="mt-0.5 text-ink-soft">Your bag is saved on this device until then.</p>
                </div>
              )}
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
