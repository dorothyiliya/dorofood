"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowSquareOut, Eye, Trash } from "@phosphor-icons/react/dist/ssr";
import { AdminLink as Link, useAdminBase } from "@/app/admin/_components/admin-link";
import { rebase } from "@/lib/admin/paths";
import { slugifyText, type DocNode } from "@/lib/content/document";
import { RichEditor } from "@/app/admin/_components/editor/rich-editor";
import { MediaPicker } from "@/app/admin/_components/editor/media-picker";
import { SeoPanel, type SeoValues } from "@/app/admin/_components/editor/seo-panel";
import { productChoicesAction, quickAddCategoryAction, restoreRevisionAction, savePostAction, trashPostAction } from "@/app/admin/actions/content";

export type EditorPost = {
  id: string | null;
  type: "POST" | "PAGE";
  title: string;
  slug: string;
  excerpt: string;
  contentJson: DocNode;
  status: "DRAFT" | "PUBLISHED" | "TRASHED";
  publishedAt: string | null;
  featuredImageUrl: string;
  featuredImageAlt: string;
  categoryIds: string[];
  tags: string[];
  productIds: string[];
  showInFooter: boolean;
  updatedAt: string | null;
} & SeoValues;

type Props = {
  initial: EditorPost;
  categories: { id: string; name: string }[];
  revisions: { id: string; createdAt: string; title: string; author: string }[];
  titlePattern: string;
  siteOrigin: string;
  otherKeyphrases: string[];
  uploads: boolean;
  aiReady: boolean;
  /** Called once when a new post is first saved and gets its id. */
  onCreated?: (id: string) => void;
};

const AUTOSAVE_MS = 30_000;
/** API routes are served at /api on both the admin host and the shop host. */
const apiUrl = (path: string) => path;

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function Panel({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-b border-slate-200 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-900">{title}<span className="text-slate-400 group-open:rotate-180" aria-hidden="true">⌄</span></summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

export function PostEditor({ initial, categories: initialCategories, revisions, titlePattern, siteOrigin, otherKeyphrases, uploads, aiReady, onCreated }: Props) {
  const base = useAdminBase();
  const isPage = initial.type === "PAGE";
  const noun = isPage ? "page" : "post";
  const listHref = isPage ? "/admin/pages" : "/admin/blog";
  const pathPrefix = isPage ? "/" : "/blog/";

  const [post, setPost] = useState<EditorPost>(initial);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.id));
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(initial.updatedAt);
  const [tab, setTab] = useState<"settings" | "seo">("settings");
  const [schedule, setSchedule] = useState(Boolean(initial.publishedAt && new Date(initial.publishedAt) > new Date()));
  const [scheduleAt, setScheduleAt] = useState(toLocalInput(initial.publishedAt));
  const [categories, setCategories] = useState(initialCategories);
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const version = useRef(0);
  const saving = useRef(false);

  const published = post.status === "PUBLISHED";
  const scheduled = published && post.publishedAt !== null && new Date(post.publishedAt) > new Date();

  const update = useCallback((patch: Partial<EditorPost>) => {
    version.current++;
    setDirty(true);
    setPost((p) => {
      const next = { ...p, ...patch };
      if (patch.title !== undefined && !slugTouched && p.status !== "PUBLISHED") next.slug = slugifyText(patch.title);
      return next;
    });
  }, [slugTouched]);

  const save = useCallback(async (intent: "draft" | "publish" | "save", opts: { autosave?: boolean } = {}) => {
    if (saving.current) return null;
    saving.current = true;
    const startedAt = version.current;
    const res = await savePostAction({
      ...post,
      id: post.id,
      intent,
      autosave: opts.autosave,
      publishAt: intent === "publish" && schedule && scheduleAt ? new Date(scheduleAt).toISOString() : null,
    });
    saving.current = false;
    if (!res.ok || !res.data) {
      if (!opts.autosave) setMessage({ ok: false, text: res.message });
      if (res.redirectTo) window.location.assign(rebase(res.redirectTo, base));
      return null;
    }
    const d = res.data;
    setPost((p) => ({ ...p, id: d.id, slug: d.slug, status: d.status, publishedAt: d.publishedAt }));
    setSlugTouched(true);
    setSavedAt(d.updatedAt);
    if (version.current === startedAt) setDirty(false);
    setMessage({ ok: true, text: res.message });
    if (!opts.autosave) {
      // Update the public blog in the background; never blocks or interrupts writing.
      void fetch(apiUrl("/api/admin/revalidate"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: d.path }) }).catch(() => undefined);
    }
    if (!post.id) {
      onCreated?.(d.id);
      window.history.replaceState(null, "", rebase(`${listHref}/${d.id}`, base));
    }
    return d;
  }, [post, schedule, scheduleAt, base, listHref, onCreated]);

  // Drafts save themselves; published posts change only when you press Update.
  useEffect(() => {
    if (!dirty || published) return;
    const t = window.setTimeout(() => {
      if (post.title.trim() || JSON.stringify(post.contentJson).length > 60) void save("save", { autosave: true });
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [dirty, published, post, save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); start(async () => { await save(published ? "save" : "draft"); }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, published]);

  function run(intent: "draft" | "publish" | "save") {
    setMessage(null);
    start(async () => { await save(intent); });
  }

  function preview() {
    start(async () => {
      const saved = published ? { id: post.id } : await save("save");
      if (saved?.id) window.open(rebase(`/admin/preview/${saved.id}`, base), "_blank", "noopener");
    });
  }

  function trash() {
    if (!post.id) return;
    const form = new FormData();
    form.set("postId", post.id);
    start(async () => {
      const res = await trashPostAction(null, form);
      if (res?.ok) { setDirty(false); window.location.assign(rebase(`${listHref}?moved=trash`, base)); }
      else setMessage({ ok: false, text: res?.message ?? "Couldn't move it to the trash." });
    });
  }

  const statusText = post.status === "DRAFT" ? "Draft" : scheduled ? `Scheduled for ${fmt(post.publishedAt!)}` : published ? `Published ${post.publishedAt ? fmt(post.publishedAt) : ""}` : "Draft";
  const saveState = pending ? "Saving…" : dirty ? (published ? "Changes not live yet: press Update" : "Unsaved changes") : savedAt ? `Saved ${fmt(savedAt)}` : "Not saved yet";
  const primaryLabel = published ? "Update" : schedule && scheduleAt ? "Schedule" : "Publish";

  return (
    <div className="-mx-4 -my-6 md:-mx-8">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur md:px-8">
        <div className="flex items-center gap-3 text-sm">
          <Link href={listHref} className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"><ArrowLeft size={16} /> All {noun}s</Link>
          <span className="hidden text-slate-300 sm:inline">|</span>
          <span className="hidden text-slate-500 sm:inline" aria-live="polite">{saveState}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {published && !scheduled && post.id && <a href={`${siteOrigin}${pathPrefix}${post.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">View <ArrowSquareOut size={14} /></a>}
          <button type="button" onClick={preview} disabled={pending} className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"><Eye size={16} /> Preview</button>
          {!published && <button type="button" onClick={() => run("draft")} disabled={pending} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-60">Save draft</button>}
          <button type="button" onClick={() => run(published ? "save" : "publish")} disabled={pending} className="rounded-md bg-brand-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60">{primaryLabel}</button>
        </div>
      </div>
      {message && <div className={`px-4 py-2 text-sm md:px-8 ${message.ok ? "bg-brand-50 text-brand-900" : "bg-red-50 text-red-800"}`} role={message.ok ? "status" : "alert"}>{message.text}</div>}

      <div className="grid gap-6 px-4 py-6 md:px-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <label className="sr-only" htmlFor="post-title">Title</label>
          <input id="post-title" value={post.title} onChange={(e) => update({ title: e.target.value })} placeholder={isPage ? "Page title, e.g. About us" : "Add a title"} maxLength={200}
            className="w-full border-0 bg-transparent px-1 font-display text-3xl font-bold tracking-tight text-slate-900 placeholder:text-slate-300 focus:outline-none sm:text-4xl" />
          <RichEditor initial={initial.contentJson} onChange={(contentJson) => update({ contentJson })} uploads={uploads} />
        </div>

        <aside className="xl:sticky xl:top-16 xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto">
          <div className="rounded-xl border border-slate-200 bg-white px-4 shadow-sm">
            <div className="-mx-4 flex border-b border-slate-200" role="tablist">
              {(["settings", "seo"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium ${tab === t ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
                  {t === "settings" ? `${isPage ? "Page" : "Post"} settings` : "SEO"}
                </button>
              ))}
            </div>

            {tab === "seo" ? (
              <div className="py-4">
                <SeoPanel kind={isPage ? "page" : "post"} title={post.title} doc={post.contentJson} excerpt={post.excerpt} values={post}
                  onChange={(patch) => { if (patch.slug !== undefined) setSlugTouched(true); update(patch); }}
                  titlePattern={titlePattern} siteOrigin={siteOrigin} pathPrefix={pathPrefix} otherKeyphrases={otherKeyphrases} featuredImageUrl={post.featuredImageUrl} aiReady={aiReady} />
              </div>
            ) : (
              <div>
                <Panel title="Publishing">
                  <p className="text-sm text-slate-700">Status: <strong>{statusText}</strong></p>
                  <fieldset className="space-y-1.5 text-sm">
                    <legend className="mb-1 text-slate-600">{published ? "Publish date" : "When should it go live?"}</legend>
                    <label className="flex items-center gap-2"><input type="radio" checked={!schedule} onChange={() => { setSchedule(false); setDirty(true); }} /> {published ? "Keep the current date" : "Straight away"}</label>
                    <label className="flex items-center gap-2"><input type="radio" checked={schedule} onChange={() => { setSchedule(true); setDirty(true); }} /> {published ? "Change the date" : "Later, at a set time"}</label>
                    {schedule && <input type="datetime-local" value={scheduleAt} onChange={(e) => { setScheduleAt(e.target.value); setDirty(true); }} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />}
                  </fieldset>
                  {published && schedule && <button type="button" onClick={() => run("publish")} disabled={pending || !scheduleAt} className="text-sm font-medium text-brand-800 hover:underline disabled:opacity-50">Apply the new date</button>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
                    {published && <button type="button" onClick={() => run("draft")} disabled={pending} className="text-slate-700 hover:underline">Switch back to draft</button>}
                    {post.id && <button type="button" onClick={trash} disabled={pending} className="inline-flex items-center gap-1 text-red-700 hover:underline"><Trash size={14} /> Move to trash</button>}
                  </div>
                </Panel>

                <Panel title="Featured picture">
                  {post.featuredImageUrl ? (
                    <div className="space-y-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- chosen featured image */}
                      <img src={post.featuredImageUrl} alt={post.featuredImageAlt} className="aspect-[16/10] w-full rounded-lg bg-slate-100 object-cover" />
                      <input value={post.featuredImageAlt} onChange={(e) => update({ featuredImageAlt: e.target.value })} placeholder="Describe the picture" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" aria-label="Describe the featured picture" />
                      <div className="flex gap-3 text-sm"><button type="button" onClick={() => setPicking(true)} className="text-brand-800 hover:underline">Change</button><button type="button" onClick={() => update({ featuredImageUrl: "", featuredImageAlt: "" })} className="text-red-700 hover:underline">Remove</button></div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setPicking(true)} className="grid aspect-[16/10] w-full place-items-center rounded-lg border-2 border-dashed border-slate-300 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-800">Choose a featured picture</button>
                  )}
                  <p className="text-xs text-slate-500">Shown at the top of the {noun}, in the blog list and when shared.</p>
                </Panel>

                {!isPage && <CategoriesPanel categories={categories} selected={post.categoryIds} onToggle={(id, on) => update({ categoryIds: on ? [...post.categoryIds, id] : post.categoryIds.filter((c) => c !== id) })}
                  onAdded={(c) => { setCategories((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name))); update({ categoryIds: [...post.categoryIds, c.id] }); }} />}
                {!isPage && <TagsPanel tags={post.tags} onChange={(tags) => update({ tags })} />}

                <Panel title="Summary" open={Boolean(post.excerpt)}>
                  <textarea value={post.excerpt} onChange={(e) => update({ excerpt: e.target.value })} rows={3} maxLength={1000} placeholder="A sentence or two for the blog list. Leave empty to use the start of the text." className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
                </Panel>

                {isPage ? (
                  <Panel title="Where it appears">
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={post.showInFooter} onChange={(e) => update({ showInFooter: e.target.checked })} className="mt-0.5" /> <span>Link to it at the bottom of every shop page (good for About, Delivery or Returns)</span></label>
                  </Panel>
                ) : (
                  <ProductsPanel selected={post.productIds} onChange={(productIds) => update({ productIds })} />
                )}

                {revisions.length > 0 && <RevisionsPanel revisions={revisions} />}
              </div>
            )}
          </div>
        </aside>
      </div>
      {picking && <MediaPicker uploads={uploads} title="Choose a featured picture" onClose={() => setPicking(false)} onPick={(img) => { update({ featuredImageUrl: img.url, featuredImageAlt: img.alt }); setPicking(false); }} />}
    </div>
  );
}

function CategoriesPanel({ categories, selected, onToggle, onAdded }: { categories: { id: string; name: string }[]; selected: string[]; onToggle: (id: string, on: boolean) => void; onAdded: (c: { id: string; name: string }) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  function add() {
    if (!name.trim()) return;
    start(async () => {
      const res = await quickAddCategoryAction(name.trim());
      if (res.ok && res.data) { onAdded(res.data); setName(""); setError(""); } else setError(res.message);
    });
  }
  return (
    <Panel title="Categories">
      {categories.length === 0 && <p className="text-sm text-slate-500">No categories yet. Add your first one below, e.g. Recipes.</p>}
      <ul className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
        {categories.map((c) => <li key={c.id}><label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => onToggle(c.id, e.target.checked)} /> {c.name}</label></li>)}
      </ul>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="New category" aria-label="New category name" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        <button type="button" onClick={add} disabled={pending} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-60">Add</button>
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </Panel>
  );
}

function TagsPanel({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [value, setValue] = useState("");
  function commit() {
    const added = value.split(",").map((t) => t.trim()).filter(Boolean);
    if (added.length) onChange([...new Set([...tags, ...added])].slice(0, 30));
    setValue("");
  }
  return (
    <Panel title="Tags" open={tags.length > 0}>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">{t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="text-slate-500 hover:text-red-700">×</button>
          </span>
        ))}
      </div>
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } }}
        placeholder="Type a tag and press Enter" aria-label="Add a tag" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
      <p className="text-xs text-slate-500">Words that describe the post, e.g. rice, party food.</p>
    </Panel>
  );
}

function ProductsPanel({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [choices, setChoices] = useState<{ id: string; name: string; image: string | null }[] | null>(null);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const load = () => start(async () => { const res = await productChoicesAction(); if (res.ok && res.data) setChoices(res.data); });
  useEffect(() => { if (selected.length) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once if products are already chosen
  const shown = useMemo(() => (choices ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 50), [choices, q]);
  return (
    <Panel title="Shop this post" open={selected.length > 0}>
      <p className="text-xs text-slate-500">Products shown under the post so readers can buy what you wrote about (up to 8).</p>
      {choices === null ? (
        <button type="button" onClick={load} disabled={pending} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium ring-1 ring-inset ring-slate-300 hover:bg-slate-50">{pending ? "Loading…" : "Choose products"}</button>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
          <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
            {shown.map((p) => (
              <li key={p.id}><label className="flex items-center gap-2">
                <input type="checkbox" checked={selected.includes(p.id)} disabled={!selected.includes(p.id) && selected.length >= 8} onChange={(e) => onChange(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} />
                {/* eslint-disable-next-line @next/next/no-img-element -- product thumbnail */}
                {p.image ? <img src={p.image} alt="" className="h-7 w-7 rounded object-cover" /> : <span className="h-7 w-7 rounded bg-slate-100" />}
                <span className="truncate">{p.name}</span>
              </label></li>
            ))}
            {shown.length === 0 && <li className="text-slate-500">No products found.</li>}
          </ul>
        </>
      )}
    </Panel>
  );
}

function RevisionsPanel({ revisions }: { revisions: { id: string; createdAt: string; title: string; author: string }[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  function restore(id: string) {
    start(async () => {
      const res = await restoreRevisionAction(id);
      if (res.ok) window.location.reload(); else setError(res.message);
    });
  }
  return (
    <Panel title={`Earlier versions (${revisions.length})`} open={false}>
      <p className="text-xs text-slate-500">Every time you save, a copy is kept. Restore one to go back to it (you can undo that too).</p>
      <ul className="space-y-2 text-sm">
        {revisions.map((r, i) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0"><span className="block truncate text-slate-800">{fmt(r.createdAt)}{i === 0 ? " (latest)" : ""}</span><span className="block truncate text-xs text-slate-500">{r.author}</span></span>
            {i > 0 && <button type="button" onClick={() => restore(r.id)} disabled={pending} className="shrink-0 text-brand-800 hover:underline disabled:opacity-50">Restore</button>}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </Panel>
  );
}
