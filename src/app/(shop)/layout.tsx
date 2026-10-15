import type { ReactNode } from "react";
import { loadStorefront } from "@/lib/storefront-data";
import { ShopProvider } from "@/components/shop/shop-provider";
import { SiteHeader } from "@/components/shop/site-header";
import { SiteFooter } from "@/components/shop/site-footer";
import { BagDrawer } from "@/components/shop/bag-drawer";

// Rebuilt at most every minute, and immediately when staff change the catalogue or settings.
export const revalidate = 60;

export default async function ShopLayout({ children }: { children: ReactNode }) {
  const data = await loadStorefront();
  return (
    <ShopProvider products={data.products} markets={data.markets} homeMarket={data.homeMarket} checkoutLive={data.checkoutLive} previewMode={data.previewMode}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink">Skip to content</a>
      <SiteHeader announcement={data.announcement} categories={data.categories} />
      <main id="main">{children}</main>
      <SiteFooter categories={data.categories} contactEmail={data.contactEmail} />
      <BagDrawer />
    </ShopProvider>
  );
}
