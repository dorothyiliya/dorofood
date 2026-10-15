import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dorocity Food — Good food finds, delivered",
  description: "Discover thoughtfully selected snacks, drinks and pantry essentials from Dorocity Food.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  openGraph: {
    title: "Dorocity Food",
    description: "Good food finds. Delivered to your door.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
