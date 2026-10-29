import Link from "next/link";
import type { Post } from "@prisma/client";
import { CaretRight, FacebookLogo, WhatsappLogo, XLogo } from "@phosphor-icons/react/dist/ssr";
import { readingMinutes, renderDoc } from "@/lib/content/document";
import type { Product } from "@/lib/catalogue";
import type { PostCard as PostCardData } from "@/lib/blog/public";
import { ProductRail } from "@/components/shop/product-rail";
import { PostCard, formatDate } from "@/components/blog/post-card";

type ArticlePost = Post & { author: { name: string } | null; categories: { name: string; slug: string }[]; tags: { name: string; slug: string }[] };

/** A blog post or page as readers see it. Used by the live site and the admin preview. */
export function Article({ post, url, products = [], related = [] }: { post: ArticlePost; url: string; products?: Product[]; related?: PostCardData[] }) {
  const isPage = post.type === "PAGE";
  const toc = renderDoc(post.contentJson).headings.filter((h) => h.level === 2);
  const share = encodeURIComponent(url);
  const shareText = encodeURIComponent(post.title);
  const shareLink = "inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink-soft transition hover:border-ink/30 hover:text-ink";

  return (
    <article className="mx-auto max-w-shop px-4 pb-16 pt-6 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-soft">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="hover:text-ink">Home</Link></li>
          {!isPage && <><li aria-hidden="true"><CaretRight size={12} /></li><li><Link href="/blog" className="hover:text-ink">Blog</Link></li></>}
          {post.categories[0] && <><li aria-hidden="true"><CaretRight size={12} /></li><li><Link href={`/blog/category/${post.categories[0].slug}`} className="hover:text-ink">{post.categories[0].name}</Link></li></>}
        </ol>
      </nav>

      <header className="mx-auto mt-8 max-w-3xl text-center">
        {!isPage && post.categories[0] && <Link href={`/blog/category/${post.categories[0].slug}`} className="text-sm font-semibold uppercase tracking-wider text-leaf-ink hover:underline">{post.categories[0].name}</Link>}
        <h1 className="mt-3 font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">{post.title}</h1>
        {post.excerpt && <p className="mx-auto mt-5 max-w-[60ch] text-lg text-ink-soft">{post.excerpt}</p>}
        {!isPage && (
          <p className="mt-5 text-sm text-ink-faint">
            {post.author?.name && <>By <span className="font-medium text-ink-soft">{post.author.name}</span> · </>}
            <time dateTime={post.publishedAt?.toISOString()}>{formatDate(post.publishedAt)}</time> · {readingMinutes(post.wordCount)} min read
          </p>
        )}
      </header>

      {post.featuredImageUrl && (
        <figure className="mx-auto mt-10 max-w-5xl">
          {/* eslint-disable-next-line @next/next/no-img-element -- staff-uploaded image */}
          <img src={post.featuredImageUrl} alt={post.featuredImageAlt ?? ""} className="aspect-[16/9] w-full rounded-[1.5rem] bg-sunken object-cover" fetchPriority="high" />
        </figure>
      )}

      <div className="mx-auto mt-10 max-w-[68ch]">
        {toc.length >= 3 && (
          <details className="mb-10 rounded-card border border-line bg-surface p-5" open>
            <summary className="cursor-pointer font-semibold">In this {isPage ? "page" : "post"}</summary>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-ink-soft">
              {toc.map((h) => <li key={h.id}><a href={`#${h.id}`} className="hover:text-ink hover:underline">{h.text}</a></li>)}
            </ol>
          </details>
        )}
        <div className="article-body text-ink" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />

        {!isPage && (
          <footer className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-line pt-8">
            <ul className="flex flex-wrap gap-2" aria-label="Tags">
              {post.tags.map((t) => <li key={t.slug}><Link href={`/blog/tag/${t.slug}`} className="inline-block rounded-full bg-sunken px-3 py-1 text-sm text-ink-soft hover:text-ink">#{t.name}</Link></li>)}
            </ul>
            <div className="flex items-center gap-2" aria-label="Share">
              <span className="mr-1 text-sm text-ink-soft">Share</span>
              <a href={`https://wa.me/?text=${shareText}%20${share}`} target="_blank" rel="noopener noreferrer" className={shareLink} aria-label="Share on WhatsApp"><WhatsappLogo size={20} /></a>
              <a href={`https://www.facebook.com/sharer/sharer.php?u=${share}`} target="_blank" rel="noopener noreferrer" className={shareLink} aria-label="Share on Facebook"><FacebookLogo size={20} /></a>
              <a href={`https://x.com/intent/post?url=${share}&text=${shareText}`} target="_blank" rel="noopener noreferrer" className={shareLink} aria-label="Share on X"><XLogo size={20} /></a>
            </div>
          </footer>
        )}
      </div>

      {products.length > 0 && (
        <section className="mt-16" aria-labelledby="shop-this-post">
          <h2 id="shop-this-post" className="mb-6 font-display text-3xl font-bold tracking-tight">Shop this {isPage ? "page" : "post"}</h2>
          <ProductRail products={products} label="Products from this post" />
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-16 border-t border-line pt-12" aria-labelledby="more-posts">
          <h2 id="more-posts" className="mb-8 font-display text-3xl font-bold tracking-tight">Keep reading</h2>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">{related.map((p) => <PostCard key={p.id} post={p} />)}</div>
        </section>
      )}
    </article>
  );
}
