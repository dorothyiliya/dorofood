import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import { BRAND } from "@/lib/brand";
import "./globals.css";

// Self-hosted at build time by next/font: no requests to Google from visitors' browsers.
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Geist({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${BRAND.name} | Nigerian groceries online`, template: `%s | ${BRAND.name}` },
  description: BRAND.description,
  // Preview deployments each have their own URL, which Vercel provides at build time.
  // The real shop address in production (APP_BASE_URL); preview deployments use their own URL.
  metadataBase: new URL(process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")),
  openGraph: { title: BRAND.name, description: BRAND.description, type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#09130e" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
