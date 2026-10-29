import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { followRedirect } from "@/lib/seo/site";
import { LivePost, liveMetadata } from "@/lib/blog/render-page";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return (await liveMetadata("POST", (await params).slug)) ?? { title: "Post not found" };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const page = await LivePost({ type: "POST", slug });
  if (page) return page;
  await followRedirect(`/blog/${slug}`);
  notFound();
}
