"use client";

import { useEffect } from "react";
import { useShop } from "@/components/shop/shop-provider";

/** Empties the bag once a payment is confirmed (never before, so a failed payment keeps the shopper's items). */
export function ClearBag() {
  const { clear } = useShop();
  useEffect(() => { clear(); }, [clear]);
  return null;
}
