"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Product } from "@/lib/catalogue";
import type { MarketSummary } from "@/lib/storefront-data";

type Line = { id: string; quantity: number };
export type BagLine = { product: Product; quantity: number };

type ShopContext = {
  products: Product[];
  markets: MarketSummary[];
  market: MarketSummary;
  homeMarket: string;
  setMarket: (code: string) => void;
  lines: BagLine[];
  count: number;
  subtotalKobo: number;
  add: (productId: string, quantity?: number) => boolean;
  setQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
  bagOpen: boolean;
  openBag: () => void;
  closeBag: () => void;
  announce: (message: string) => void;
  canShip: (product: Product) => boolean;
  checkoutLive: boolean;
  previewMode: boolean;
};

const Ctx = createContext<ShopContext | null>(null);
/** Mirrors the server-side per-product limit. */
export const MAX_QUANTITY = 50;
const BAG_KEY = "dorocity.bag.v1";
const MARKET_KEY = "dorocity.market.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: the bag still works for this visit */
  }
}

export function ShopProvider({ products, markets, homeMarket, checkoutLive, previewMode, children }: {
  products: Product[]; markets: MarketSummary[]; homeMarket: string; checkoutLive: boolean; previewMode: boolean; children: ReactNode;
}) {
  const [stored, setStored] = useState<Line[]>([]);
  const [marketCode, setMarketCode] = useState(homeMarket);
  const [bagOpen, setBagOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setStored(read<Line[]>(BAG_KEY, []).filter((l) => typeof l?.id === "string" && Number.isInteger(l.quantity) && l.quantity > 0));
    const savedMarket = read<string>(MARKET_KEY, homeMarket);
    if (markets.some((m) => m.code === savedMarket)) setMarketCode(savedMarket);
    setHydrated(true);
  }, [homeMarket, markets]);

  useEffect(() => { if (hydrated) write(BAG_KEY, stored); }, [stored, hydrated]);
  useEffect(() => { if (hydrated) write(MARKET_KEY, marketCode); }, [marketCode, hydrated]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // Lines for products that no longer exist (removed from the catalogue) are dropped.
  const lines = useMemo(() => stored.flatMap((l) => (byId.has(l.id) ? [{ product: byId.get(l.id)!, quantity: l.quantity }] : [])), [stored, byId]);
  const market = markets.find((m) => m.code === marketCode) ?? markets[0] ?? { code: homeMarket, name: homeMarket, currency: "NGN", countryCode: homeMarket, delivers: false, flatRateMinor: null };
  const canShip = useCallback((p: Product) => p.shipsTo.includes(market.code), [market.code]);

  const announce = useCallback((text: string) => {
    setMessage("");
    window.setTimeout(() => setMessage(text), 30);
  }, []);

  const add = useCallback((productId: string, quantity = 1) => {
    const product = byId.get(productId);
    if (!product || !product.available) return false;
    setStored((current) => {
      const found = current.find((l) => l.id === productId);
      if (found) return current.map((l) => (l.id === productId ? { ...l, quantity: Math.min(l.quantity + quantity, MAX_QUANTITY) } : l));
      return [...current, { id: productId, quantity: Math.min(quantity, MAX_QUANTITY) }];
    });
    announce(`${product.name} added to your bag.`);
    return true;
  }, [byId, announce]);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setStored((current) => quantity <= 0 ? current.filter((l) => l.id !== productId) : current.map((l) => (l.id === productId ? { ...l, quantity: Math.min(quantity, MAX_QUANTITY) } : l)));
  }, []);

  // Writes storage immediately: a child's effect (the order-confirmed page) can run
  // before this provider has hydrated the saved bag, which would otherwise restore it.
  const clear = useCallback(() => { write(BAG_KEY, []); setStored([]); }, []);
  const openBag = useCallback(() => setBagOpen(true), []);
  const closeBag = useCallback(() => setBagOpen(false), []);

  const value: ShopContext = {
    products, markets, market, homeMarket, setMarket: setMarketCode,
    lines,
    count: lines.reduce((s, l) => s + l.quantity, 0),
    subtotalKobo: lines.reduce((s, l) => s + l.product.priceKobo * l.quantity, 0),
    add, setQuantity, clear,
    bagOpen, openBag, closeBag,
    announce, canShip, checkoutLive, previewMode,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <p className="sr-only" role="status" aria-live="polite">{message}</p>
    </Ctx.Provider>
  );
}

export function useShop() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShop must be used inside ShopProvider");
  return ctx;
}
