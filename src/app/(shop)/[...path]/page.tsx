import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { followRedirect } from "@/lib/seo/site";
import { LivePost, liveMetadata } from "@/lib/blog/render-page";

/**
 * Anything the shop has no route for: a page made in the admin (e.g. /about),
 * else a saved redirect from an old address, else "not found".
 */
type Props = { params: Promise<{ path: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  return (path.length === 1 && (await liveMetadata("PAGE", path[0]))) || { title: "Page not found" };
}

export default async function CatchAllPage({ params }: Props) {
  const { path } = await params;
  if (path.length === 1) {
    const page = await LivePost({ type: "PAGE", slug: path[0] });
    if (page) return page;
  }
  await followRedirect(`/${path.map(decodeURIComponent).join("/")}`);
  notFound();
}
