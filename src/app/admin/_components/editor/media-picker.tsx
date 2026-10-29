"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { X } from "@phosphor-icons/react/dist/ssr";
import { listMediaAction, uploadMediaAction } from "@/app/admin/actions/content";

export type PickedImage = { url: string; alt: string; caption?: string };
type Item = { id: string; url: string; altText: string; fileName: string };

/** Upload a new picture, reuse one from the library, or paste an address; then describe it. */
export function MediaPicker({ uploads, title, withCaption, onPick, onClose }: { uploads: boolean; title: string; withCaption?: boolean; onPick: (img: PickedImage) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"upload" | "library" | "url">(uploads ? "upload" : "library");
  const [chosen, setChosen] = useState<{ url: string; alt: string } | null>(null);
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlValue, setUrlValue] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab !== "library") return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      start(async () => {
        const res = await listMediaAction({ q });
        if (!cancelled) { if (res.ok && res.data) setItems(res.data.items); else setError(res.message); }
      });
    }, q ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [tab, q]);

  function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose a picture first."); return; }
    const form = new FormData();
    form.set("file", file);
    form.set("altText", alt);
    setError("");
    start(async () => {
      const res = await uploadMediaAction(form);
      if (!res.ok || !res.data) { setError(res.message); return; }
      setChosen({ url: res.data.url, alt: alt || res.data.altText });
    });
  }

  function confirm() {
    if (!chosen) return;
    onPick({ url: chosen.url, alt: alt.trim() || chosen.alt, caption: caption.trim() || undefined });
  }

  const tabBtn = (key: typeof tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setChosen(null); setError(""); }}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{label}</button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex gap-1 border-b border-slate-200 px-4" role="tablist">
          {uploads && tabBtn("upload", "Upload a new picture")}
          {tabBtn("library", "Your picture library")}
          {tabBtn("url", "From a web address")}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === "upload" && !chosen && (
            <div className="space-y-3">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-800 hover:file:bg-brand-100" />
              <p className="text-xs text-slate-500">JPEG, PNG or WebP, up to 4 MB. It is saved to your picture library so you can reuse it.</p>
              <button type="button" onClick={upload} disabled={pending} className="rounded-md bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60">{pending ? "Uploading…" : "Upload"}</button>
            </div>
          )}
          {tab === "library" && !chosen && (
            <div className="space-y-3">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your pictures" aria-label="Search pictures" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
              {items === null ? <p className="text-sm text-slate-500">Loading…</p> : items.length === 0 ? <p className="text-sm text-slate-500">No pictures yet. Upload one first.</p> : (
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {items.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => { setChosen({ url: m.url, alt: m.altText }); setAlt(m.altText); }} className="block w-full overflow-hidden rounded-lg border border-slate-200 hover:ring-2 hover:ring-brand-500">
                        {/* eslint-disable-next-line @next/next/no-img-element -- media library thumbnail */}
                        <img src={m.url} alt={m.altText} className="aspect-square w-full bg-slate-100 object-cover" loading="lazy" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {tab === "url" && !chosen && (
            <div className="space-y-3">
              <input value={urlValue} onChange={(e) => setUrlValue(e.target.value)} placeholder="https://…" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
              <button type="button" onClick={() => /^https:\/\/\S+$/.test(urlValue.trim()) ? setChosen({ url: urlValue.trim(), alt: "" }) : setError("Paste a full picture address starting with https://")} className="rounded-md bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900">Use this picture</button>
            </div>
          )}
          {chosen && (
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element -- chosen picture preview */}
              <img src={chosen.url} alt="" className="w-full rounded-lg border border-slate-200 bg-slate-100 object-cover" />
              <div className="space-y-3 text-sm">
                <label className="block">
                  <span className="mb-1 block font-medium text-slate-700">Describe the picture</span>
                  <input autoFocus value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} placeholder="e.g. A plate of smoky jollof rice with fried plantain" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5" />
                  <span className="mt-1 block text-xs text-slate-500">Helps Google understand the picture and is read aloud to blind visitors.</span>
                </label>
                {withCaption && (
                  <label className="block">
                    <span className="mb-1 block font-medium text-slate-700">Caption (optional)</span>
                    <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Shown under the picture" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5" />
                  </label>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={confirm} className="rounded-md bg-brand-800 px-4 py-2 font-semibold text-white hover:bg-brand-900">Use picture</button>
                  <button type="button" onClick={() => setChosen(null)} className="rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100">Choose another</button>
                </div>
              </div>
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}
