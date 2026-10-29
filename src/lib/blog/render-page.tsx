import "server-only";
import type { Metadata } from "next";
import { getLivePost, productSlugs, relatedPosts } from "@/lib/blog/public";
import { postPath } from "@/lib/blog/posts";
import { loadStorefront } from "@/lib/storefront-data";
import { absoluteUrl, breadcrumbJsonLd, jsonLd, pageMetadata, seoSettings } from "@/lib/seo/site";
import { summary } from "@/lib/blog/public";
import { BRAND } from "@/lib/brand";
import { Article } from "@/components/blog/article";

/** Shared by /blog/[slug] (posts) and /[slug] (pages). */
export async function liveMetadata(type: "POST" | "PAGE", slug: string): Promise<Metadata | null> {
  const post = await getLivePost(type, slug);
  if (!post) return null;
  return pageMetadata({
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt || summary(post, 158),
    path: postPath(type, post.slug),
    canonical: post.canonicalUrl,
    image: post.socialImageUrl || post.featuredImageUrl ? { url: (post.socialImageUrl || post.featuredImageUrl)!, alt: post.featuredImageAlt } : null,
    type: type === "POST" ? "article" : "website",
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
    author: post.author?.name,
    noindex: post.noindex,
  });
}

export async function LivePost({ type, slug }: { type: "POST" | "PAGE"; slug: string }) {
  const post = await getLivePost(type, slug);
  if (!post) return null;
  const url = absoluteUrl(postPath(type, post.slug));
  const [slugs, related, storefront, seo] = await Promise.all([
    productSlugs(post.productIds),
    type === "POST" ? relatedPosts(post.id, post.categories.map((c) => c.slug)) : [],
    post.productIds.length ? loadStorefront() : null,
    seoSettings(),
  ]);
  const products = storefront ? slugs.map((s) => storefront.products.find((p) => p.slug === s)).filter((p): p is NonNullable<typeof p> => Boolean(p)) : [];
  const description = post.seoDescription || post.excerpt || summary(post, 158);
  const structured = type === "POST"
    ? {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: post.title.slice(0, 110),
        description,
        ...(post.featuredImageUrl ? { image: [absoluteUrl(post.featuredImageUrl)] } : {}),
        datePublished: post.publishedAt?.toISOString(),
        dateModified: post.updatedAt.toISOString(),
        author: post.author ? { "@type": "Person", name: post.author.name } : { "@type": "Organization", name: BRAND.name },
        publisher: { "@type": "Organization", name: BRAND.name, logo: { "@type": "ImageObject", url: absoluteUrl(BRAND.mark.light) } },
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        ...(post.categories[0] ? { articleSection: post.categories[0].name } : {}),
        ...(post.tags.length ? { keywords: post.tags.map((t) => t.name).join(", ") } : {}),
        wordCount: post.wordCount,
        inLanguage: "en",
      }
    : { "@context": "https://schema.org", "@type": "WebPage", name: post.title, description, url };
  const crumbs = breadcrumbJsonLd(type === "POST"
    ? [{ name: "Home", path: "/" }, { name: seo.blogTitle, path: "/blog" }, ...(post.categories[0] ? [{ name: post.categories[0].name, path: `/blog/category/${post.categories[0].slug}` }] : []), { name: post.title, path: postPath(type, post.slug) }]
    : [{ name: "Home", path: "/" }, { name: post.title, path: postPath(type, post.slug) }]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(crumbs)} />
      <Article post={post} url={url} products={products} related={related} />
    </>
  );
}
