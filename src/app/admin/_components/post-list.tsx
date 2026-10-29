import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import type { PostType, Prisma } from "@prisma/client";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { prisma } from "@/lib/prisma";
import { postPath, postState } from "@/lib/blog/posts";
import { scoreLabel } from "@/lib/seo/analysis";
import { siteOrigin } from "@/lib/seo/site";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, DateTime, Notice, PageHeader, Pagination, StatusBadge, Table, inputClass, pageParam, stringParam, td } from "@/app/admin/_components/ui";
import { deletePostForeverAction, restorePostAction, trashPostAction } from "@/app/admin/actions/content";

const PAGE_SIZE = 30;
const DOT = { good: "bg-brand-600", ok: "bg-amber-400", bad: "bg-red-500" } as const;

/** The list of posts or pages, WordPress-style: filter tabs, search, quick actions. */
export async function PostList({ type, params, editable }: { type: PostType; params: Record<string, string | string[] | undefined>; editable: boolean }) {
  const isPage = type === "PAGE";
  const base = isPage ? "/admin/pages" : "/admin/blog";
  const tab = (["all", "published", "scheduled", "drafts", "trash"] as const).find((t) => t === params.show) ?? "all";
  const q = stringParam(params.q);
  const page = pageParam(params.page);
  const now = new Date();
  const filter: Record<typeof tab, Prisma.PostWhereInput> = {
    all: { status: { not: "TRASHED" } },
    published: { status: "PUBLISHED", publishedAt: { lte: now } },
    scheduled: { status: "PUBLISHED", publishedAt: { gt: now } },
    drafts: { status: "DRAFT" },
    trash: { status: "TRASHED" },
  };
  const where: Prisma.PostWhereInput = { type, ...filter[tab], ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) };
  const [rows, counts] = await Promise.all([
    prisma.post.findMany({ where, orderBy: [{ updatedAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1, include: { author: { select: { name: true } }, categories: { select: { name: true } } } }),
    Promise.all((Object.keys(filter) as (typeof tab)[]).map(async (k) => [k, await prisma.post.count({ where: { type, ...filter[k] } })] as const)),
  ]);
  const count = Object.fromEntries(counts) as Record<typeof tab, number>;
  const origin = siteOrigin();
  const labels: Record<typeof tab, string> = { all: "All", published: "Published", scheduled: "Scheduled", drafts: "Drafts", trash: "Trash" };

  return (
    <>
      <PageHeader title={isPage ? "Pages" : "Blog posts"}
        description={isPage ? "Pages that aren't blog posts, like About us, Delivery information or Returns." : "Recipes, stories and news. Write, schedule and publish them here."}
        actions={editable && <Link href={`${base}/new`} className="inline-flex items-center gap-1.5 rounded-md bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900"><Plus size={16} weight="bold" /> {isPage ? "Add a page" : "Write a post"}</Link>} />
      {params.moved === "trash" && <div className="mb-4"><Notice tone="good">Moved to the trash. You can restore it from the Trash tab.</Notice></div>}
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-slate-200" aria-label="Filter">
        {(Object.keys(labels) as (typeof tab)[]).map((k) => (
          <Link key={k} href={k === "all" ? base : `${base}?show=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {labels[k]} <span className="text-slate-400">({count[k]})</span>
          </Link>
        ))}
      </nav>
      <Card>
        <form className="mb-4 flex gap-2" role="search">
          {tab !== "all" && <input type="hidden" name="show" value={tab} />}
          <input name="q" defaultValue={q} placeholder={`Search ${isPage ? "pages" : "posts"} by title`} aria-label="Search" className={`${inputClass} sm:!w-72`} />
          <button className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white">Search</button>
        </form>
        <Table head={["Title", ...(isPage ? [] : ["Category"]), "Status", "SEO", "Last changed", ""]}
          empty={tab === "trash" ? "The trash is empty." : isPage ? "No pages yet. Add an About us page to start." : "No posts yet. Press “Write a post” to write your first one."}>
          {rows.slice(0, PAGE_SIZE).map((p) => {
            const state = postState(p, now);
            const seo = scoreLabel(p.seoScore);
            return (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className={td}>
                  {p.status === "TRASHED" ? <span className="font-medium text-slate-700">{p.title}</span> : <Link href={`${base}/${p.id}`} className="font-medium text-brand-800 hover:underline">{p.title}</Link>}
                  <div className="text-xs text-slate-500">{postPath(type, p.slug)}{p.author ? ` · ${p.author.name}` : ""}</div>
                </td>
                {!isPage && <td className={`${td} text-sm text-slate-600`}>{p.categories.map((c) => c.name).join(", ") || "-"}</td>}
                <td className={td}>
                  <StatusBadge status={state} tone={state === "Published" ? "good" : state === "Scheduled" ? "info" : "neutral"} />
                  {state === "Scheduled" && p.publishedAt && <div className="mt-1 text-xs text-slate-500"><DateTime value={p.publishedAt} /></div>}
                </td>
                <td className={td}><span className="inline-flex items-center gap-1.5 text-xs text-slate-700"><span className={`h-2.5 w-2.5 rounded-full ${DOT[seo.tone]}`} aria-hidden="true" />{seo.label}</span></td>
                <td className={`${td} text-sm`}><DateTime value={p.updatedAt} /></td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {editable && p.status !== "TRASHED" && (
                    <div className="flex justify-end gap-3 text-sm">
                      {state === "Published" && <a href={`${origin}${postPath(type, p.slug)}`} target="_blank" rel="noreferrer" className="text-slate-600 hover:underline">View</a>}
                      <Link href={`${base}/${p.id}`} className="text-brand-800 hover:underline">Edit</Link>
                      <ActionForm action={trashPostAction} hidden={{ postId: p.id }} submitLabel="Trash" variant="secondary" inline />
                    </div>
                  )}
                  {editable && p.status === "TRASHED" && (
                    <div className="flex justify-end gap-2">
                      <ActionForm action={restorePostAction} hidden={{ postId: p.id }} submitLabel="Restore" variant="secondary" inline />
                      <ActionForm action={deletePostForeverAction} hidden={{ postId: p.id }} submitLabel="Delete for good" variant="danger" inline />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
        <Pagination page={page} hasNext={rows.length > PAGE_SIZE} href={(n) => `${base}?${new URLSearchParams({ ...(tab !== "all" ? { show: tab } : {}), ...(q ? { q } : {}), page: String(n) })}`} />
      </Card>
    </>
  );
}
