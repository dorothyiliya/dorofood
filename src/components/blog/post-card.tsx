import Link from "next/link";
import { readingMinutes } from "@/lib/content/document";
import { summary, type PostCard as PostCardData } from "@/lib/blog/public";

export const formatDate = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }) : "");

export function PostCard({ post, large = false, priority = false }: { post: PostCardData; large?: boolean; priority?: boolean }) {
  return (
    <article className={`group flex flex-col ${large ? "lg:grid lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-10" : ""}`}>
      <Link href={`/blog/${post.slug}`} className="block overflow-hidden rounded-card bg-sunken" tabIndex={-1} aria-hidden="true">
        {post.featuredImageUrl
          // eslint-disable-next-line @next/next/no-img-element -- staff-uploaded image
          ? <img src={post.featuredImageUrl} alt="" loading={priority ? "eager" : "lazy"} className={`w-full object-cover transition duration-500 group-hover:scale-[1.03] ${large ? "aspect-[16/10]" : "aspect-[4/3]"}`} />
          : <div className={`grid w-full place-items-center bg-leaf-soft font-display text-4xl font-bold text-leaf-ink ${large ? "aspect-[16/10]" : "aspect-[4/3]"}`} aria-hidden="true">{post.title.slice(0, 1)}</div>}
      </Link>
      <div className="mt-4 flex flex-1 flex-col">
        {post.categories[0] && <Link href={`/blog/category/${post.categories[0].slug}`} className="text-xs font-semibold uppercase tracking-wider text-leaf-ink hover:underline">{post.categories[0].name}</Link>}
        <h3 className={`mt-1.5 font-display font-bold leading-tight tracking-tight text-ink ${large ? "text-3xl sm:text-4xl" : "text-xl"}`}>
          <Link href={`/blog/${post.slug}`} className="hover:underline">{post.title}</Link>
        </h3>
        <p className={`mt-2 text-ink-soft ${large ? "text-lg" : "line-clamp-3 text-[15px]"}`}>{summary(post, large ? 240 : 150)}</p>
        <p className="mt-3 text-xs text-ink-faint">{formatDate(post.publishedAt)} · {readingMinutes(post.wordCount)} min read</p>
      </div>
    </article>
  );
}
