import type { ReactNode } from "react";
import { loadStorefront } from "@/lib/storefront-data";
import { ShopProvider } from "@/components/shop/shop-provider";
import { SiteHeader } from "@/components/shop/site-header";
import { SiteFooter } from "@/components/shop/site-footer";
import { BagDrawer } from "@/components/shop/bag-drawer";
import type { Metadata } from "next";
import { footerPages } from "@/lib/blog/public";
import { absoluteUrl, seoSettings } from "@/lib/seo/site";

/** Site-wide search settings: verification codes, default description, hiding the site. */
export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoSettings().catch(() => null);
  if (!seo) return {};
  const hidden = seo.hideFromSearch || process.env.VERCEL_ENV === "preview";
  return {
    description: seo.description,
    robots: hidden ? { index: false, follow: false } : undefined,
    verification: { google: seo.googleVerification || undefined, other: seo.bingVerification ? { "msvalidate.01": seo.bingVerification } : undefined },
    alternates: { types: { "application/rss+xml": [{ url: absoluteUrl("/blog/feed.xml"), title: seo.blogTitle }] } },
  };
}

// Rebuilt at most every minute, and immediately when staff change the catalogue or settings.
export const revalidate = 60;

export default async function ShopLayout({ children }: { children: ReactNode }) {
  const [data, pages] = await Promise.all([loadStorefront(), footerPages()]);
  return (
    <ShopProvider products={data.products} markets={data.markets} homeMarket={data.homeMarket} checkoutLive={data.checkoutLive} previewMode={data.previewMode}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink">Skip to content</a>
      <SiteHeader announcement={data.announcement} categories={data.categories} />
      <main id="main">{children}</main>
      <SiteFooter categories={data.categories} contactEmail={data.contactEmail} pages={pages} />
      <BagDrawer />
    </ShopProvider>
  );
}
