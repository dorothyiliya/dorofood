"use client";

import { useState } from "react";
import { Globe, Truck } from "@phosphor-icons/react/dist/ssr";
import { formatPrice, type Product } from "@/lib/catalogue";
import { AddToBag } from "@/components/shop/add-to-bag";
import { QuantityStepper } from "@/components/shop/bag-drawer";
import { useShop } from "@/components/shop/shop-provider";

/** Quantity, add to bag and delivery facts for the shopper's chosen destination. */
export function ProductPurchase({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1);
  const { market, markets, homeMarket, openBag } = useShop();
  const ships = product.shipsTo.includes(market.code);
  const otherDestinations = markets.filter((m) => m.code !== homeMarket && product.shipsTo.includes(m.code));

  return (
    <div className="space-y-6">
      {product.available && ships && (
        <div className="flex items-center gap-3">
          <QuantityStepper value={quantity} onChange={(n) => setQuantity(Math.max(1, n))} label={product.name} />
          <div className="flex-1"><AddToBag product={product} quantity={quantity} size="lg" onAdded={() => { setQuantity(1); openBag(); }} /></div>
        </div>
      )}
      {(!product.available || !ships) && <AddToBag product={product} size="lg" />}

      <div className="divide-y divide-line rounded-card border border-line bg-surface">
        <div className="flex gap-3 p-4">
          <Truck size={22} weight="duotone" className="mt-0.5 shrink-0 text-leaf" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold">Delivery to {market.name}</p>
            <p className="mt-0.5 text-ink-soft">
              {!ships ? `This item is not sold for delivery to ${market.name}.`
                : market.countries.length > 1 ? `From ${formatPrice(Math.min(...market.countries.map((c) => Number(c.flatRateMinor))), market.currency)} per order depending on the country, shown again before you pay.`
                : market.delivers && market.flatRateMinor ? `${formatPrice(Number(market.flatRateMinor), market.currency)} per order, shown again before you pay.`
                : "Delivery to this destination is not open yet."}
            </p>
          </div>
        </div>
        <div className="flex gap-3 p-4">
          <Globe size={22} weight="duotone" className="mt-0.5 shrink-0 text-leaf" aria-hidden="true" />
          <p className="text-sm text-ink-soft">
            {otherDestinations.length > 0
              ? <>Also cleared for export to {otherDestinations.map((m) => m.name).join(", ")}.</>
              : <>Sold for delivery within {markets.find((m) => m.code === homeMarket)?.name ?? "Nigeria"} only.</>}
          </p>
        </div>
      </div>
    </div>
  );
}
