import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: `Admin | ${BRAND.name}`, template: `%s | Admin | ${BRAND.name}` },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">{children}</div>;
}
