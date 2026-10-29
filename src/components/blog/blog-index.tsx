import Link from "next/link";
import { MagnifyingGlass, Rss } from "@phosphor-icons/react/dist/ssr";
import type { PostCard as PostCardData } from "@/lib/blog/public";
import { PostCard } from "@/components/blog/post-card";

/** The blog home, a category, a tag or search results: same layout. */
export function BlogIndex({ title, description, posts, categories, activeCategory, page, hasNext, baseHref, q, featured }: {
  title: string;
  description?: string | null;
  posts: PostCardData[];
  categories: { name: string; slug: string }[];
  activeCategory?: string;
  page: number;
  hasNext: boolean;
  baseHref: string;
  q?: string;
  featured?: boolean;
}) {
  const [lead, ...rest] = featured ? posts : [];
  const grid = featured ? rest : posts;
  const href = (n: number) => `${baseHref}${n > 1 || q ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}` : ""}`;
  const chip = (active: boolean) => `whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-ink text-canvas" : "bg-surface text-ink-soft ring-1 ring-line hover:text-ink"}`;
  return (
    <div className="mx-auto max-w-shop px-4 pb-16 pt-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
          {description && <p className="mt-3 text-lg text-ink-soft">{description}</p>}
        </div>
        <div className="flex items-center gap-3">
          <form action="/blog" role="search" className="relative">
            <label htmlFor="blog-search" className="sr-only">Search the blog</label>
            <MagnifyingGlass size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
            <input id="blog-search" name="q" type="search" defaultValue={q} placeholder="Search the blog" className="h-11 w-60 rounded-full border border-line bg-surface pl-11 pr-4 text-[15px] placeholder:text-ink-faint focus:border-leaf focus:outline-none focus:ring-4 focus:ring-leaf/15" />
          </form>
          <a href="/blog/feed.xml" className="grid h-11 w-11 place-items-center rounded-full border border-line text-ink-soft hover:text-ink" aria-label="RSS feed"><Rss size={18} /></a>
        </div>
      </header>

      {categories.length > 0 && (
        <nav aria-label="Blog categories" className="scrollbar-none -mx-4 mt-8 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Link href="/blog" className={chip(!activeCategory && !q)}>All</Link>
          {categories.map((c) => <Link key={c.slug} href={`/blog/category/${c.slug}`} className={chip(activeCategory === c.slug)}>{c.name}</Link>)}
        </nav>
      )}

      {posts.length === 0 ? (
        <p className="mt-16 text-center text-lg text-ink-soft">{q ? `Nothing found for "${q}". Try another word.` : "Nothing here yet. Check back soon."}</p>
      ) : (
        <>
          {lead && <div className="mt-10 border-b border-line pb-12"><PostCard post={lead} large priority /></div>}
          <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">{grid.map((p, i) => <PostCard key={p.id} post={p} priority={!lead && i < 3} />)}</div>
        </>
      )}

      {(page > 1 || hasNext) && (
        <nav aria-label="Pages" className="mt-14 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={href(page - 1)} className="font-semibold hover:underline">← Newer posts</Link> : <span />}
          <span className="text-ink-faint">Page {page}</span>
          {hasNext ? <Link href={href(page + 1)} className="font-semibold hover:underline">Older posts →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
