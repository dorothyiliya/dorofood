import { listPosts, summary } from "@/lib/blog/public";
import { absoluteUrl, seoSettings } from "@/lib/seo/site";
import { escapeHtml } from "@/lib/content/document";

// Built on request (cached by the CDN for 10 minutes), so builds never depend on the database.
export const dynamic = "force-dynamic";

/** RSS 2.0 feed of the latest posts, for feed readers and newsletter tools. */
export async function GET() {
  const [{ posts }, seo] = await Promise.all([listPosts({ page: 1 }), seoSettings()]);
  const items = posts.map((p) => {
    const url = absoluteUrl(`/blog/${p.slug}`);
    return `    <item>
      <title>${escapeHtml(p.title)}</title>
      <link>${escapeHtml(url)}</link>
      <guid isPermaLink="true">${escapeHtml(url)}</guid>
      <pubDate>${(p.publishedAt ?? p.updatedAt).toUTCString()}</pubDate>
      ${p.categories.map((c) => `<category>${escapeHtml(c.name)}</category>`).join("")}
      <description>${escapeHtml(summary(p, 300))}</description>${p.featuredImageUrl ? `\n      <enclosure url="${escapeHtml(absoluteUrl(p.featuredImageUrl))}" type="image/jpeg" length="0" />` : ""}
    </item>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(seo.blogTitle)}</title>
    <link>${escapeHtml(absoluteUrl("/blog"))}</link>
    <atom:link href="${escapeHtml(absoluteUrl("/blog/feed.xml"))}" rel="self" type="application/rss+xml" />
    <description>${escapeHtml(seo.blogDescription)}</description>
    <language>en</language>
${items}
  </channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=3600" } });
}

