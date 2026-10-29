"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { Sparkle } from "@phosphor-icons/react/dist/ssr";
import { renderDoc, type DocNode } from "@/lib/content/document";
import { analyse, DESCRIPTION_RANGE, scoreLabel, TITLE_RANGE, type Check } from "@/lib/seo/analysis";
import { applyTitlePattern } from "@/lib/seo/title";
import { suggestDescriptionAction } from "@/app/admin/actions/content";

export type SeoValues = { focusKeyphrase: string; seoTitle: string; seoDescription: string; slug: string; noindex: boolean; canonicalUrl: string; socialImageUrl: string };

const DOT = { good: "bg-brand-600", ok: "bg-amber-400", bad: "bg-red-500" } as const;
const WORD = { good: "Good", ok: "Could be better", bad: "Needs fixing" } as const;

export function ScorePill({ score, label }: { score: number | null; label: string }) {
  const { label: text, tone } = scoreLabel(score);
  return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700"><span className={`h-2.5 w-2.5 rounded-full ${DOT[tone]}`} aria-hidden="true" />{label}: {text}</span>;
}

function Meter({ length, range }: { length: number; range: readonly [number, number] }) {
  const pct = Math.min(100, (length / (range[1] * 1.2)) * 100);
  const tone = length === 0 ? "bad" : length < range[0] || length > range[1] ? "ok" : "good";
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${DOT[tone]}`} style={{ width: `${pct}%` }} /></div>
      <span className="w-20 text-right text-[11px] tabular-nums text-slate-500">{length} / {range[1]}</span>
    </div>
  );
}

function CheckList({ checks }: { checks: Check[] }) {
  const order = { bad: 0, ok: 1, good: 2 };
  return (
    <ul className="space-y-2">
      {[...checks].sort((a, b) => order[a.status] - order[b.status]).map((c) => (
        <li key={c.id} className="flex gap-2 text-sm text-slate-700">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[c.status]}`} aria-hidden="true" />
          <span><span className="sr-only">{WORD[c.status]}: </span>{c.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function SeoPanel({ kind, title, doc, excerpt, values, onChange, titlePattern, siteOrigin, pathPrefix, otherKeyphrases, featuredImageUrl, aiReady }: {
  kind: "post" | "page";
  title: string;
  doc: DocNode;
  excerpt: string;
  values: SeoValues;
  onChange: (patch: Partial<SeoValues>) => void;
  titlePattern: string;
  siteOrigin: string;
  pathPrefix: string;
  otherKeyphrases: string[];
  featuredImageUrl: string;
  aiReady: boolean;
}) {
  const deferredDoc = useDeferredValue(doc);
  const rendered = useMemo(() => renderDoc(deferredDoc, { siteOrigin }), [deferredDoc, siteOrigin]);
  const googleTitle = applyTitlePattern(values.seoTitle.trim() || title || "Untitled", titlePattern);
  const description = values.seoDescription.trim() || excerpt.trim() || rendered.text.slice(0, 155);
  const analysis = useMemo(() => analyse({
    kind, keyphrase: values.focusKeyphrase, seoTitle: googleTitle, slug: values.slug, metaDescription: values.seoDescription.trim() || excerpt.trim(),
    rendered, hasFeaturedImage: Boolean(featuredImageUrl), otherKeyphrases,
  }), [kind, values.focusKeyphrase, googleTitle, values.slug, values.seoDescription, excerpt, rendered, featuredImageUrl, otherKeyphrases]);
  const host = (() => { try { return new URL(siteOrigin).host.replace(/^www\./, ""); } catch { return "your-shop"; } })();
  const [aiMessage, setAiMessage] = useState("");
  const [pending, start] = useTransition();

  function suggest() {
    setAiMessage("");
    start(async () => {
      const res = await suggestDescriptionAction({ title, keyphrase: values.focusKeyphrase, text: rendered.text });
      if (res.ok && res.data) onChange({ seoDescription: res.data.description });
      setAiMessage(res.message);
    });
  }

  const input = "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <ScorePill score={analysis.seo.score} label="SEO" />
        {analysis.readability.checks.length > 0 && <ScorePill score={analysis.readability.score} label="Readability" />}
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-800">Focus keyphrase</span>
        <input value={values.focusKeyphrase} onChange={(e) => onChange({ focusKeyphrase: e.target.value })} maxLength={100} placeholder="e.g. jollof rice recipe" className={input} />
        <span className="mt-1 block text-xs text-slate-500">The words you want people to find this {kind} with on Google.</span>
      </label>

      <section aria-label="Google preview">
        <h3 className="mb-2 text-sm font-medium text-slate-800">How it looks on Google</h3>
        <div className="rounded-lg border border-slate-200 bg-white p-3 font-[Arial,sans-serif]">
          <div className="truncate text-[12px] text-[#202124]">{host} › {pathPrefix.replace(/^\/|\/$/g, "").split("/").filter(Boolean).concat(values.slug || "…").join(" › ")}</div>
          <div className="mt-0.5 line-clamp-2 text-[18px] leading-snug text-[#1a0dab]">{googleTitle.length > 62 ? `${googleTitle.slice(0, 60)}…` : googleTitle}</div>
          <div className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-[#4d5156]">{description ? (description.length > 160 ? `${description.slice(0, 157)}…` : description) : "Add a description so Google shows something useful here."}</div>
        </div>
      </section>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-800">Google title</span>
        <input value={values.seoTitle} onChange={(e) => onChange({ seoTitle: e.target.value })} maxLength={120} placeholder={title || "Uses your title"} className={input} />
        <Meter length={googleTitle.length} range={TITLE_RANGE} />
        <span className="mt-1 block text-xs text-slate-500">Leave empty to use the {kind} title. Your shop name is added automatically.</span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-800">Web address</span>
        <div className="flex rounded-md shadow-sm">
          <span className="inline-flex items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-2 text-xs text-slate-500">{pathPrefix}</span>
          <input value={values.slug} onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-") })} maxLength={120} className={`${input} rounded-l-none`} />
        </div>
        <span className="mt-1 block text-xs text-slate-500">Short and with your keyphrase is best. If you change it after publishing, the old address keeps working.</span>
      </label>

      <div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-800">Google description</span>
          <textarea value={values.seoDescription} onChange={(e) => onChange({ seoDescription: e.target.value })} maxLength={320} rows={3} placeholder="One or two sentences that make people want to click." className={input} />
        </label>
        <Meter length={(values.seoDescription.trim() || excerpt.trim()).length} range={DESCRIPTION_RANGE} />
        {aiReady && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={suggest} disabled={pending || rendered.wordCount < 20}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-brand-800 shadow-sm ring-1 ring-inset ring-brand-200 hover:bg-brand-50 disabled:opacity-50">
              <Sparkle size={14} weight="fill" aria-hidden="true" /> {pending ? "Writing…" : "Write it for me"}
            </button>
            {aiMessage && <span className="text-xs text-slate-600" role="status">{aiMessage}</span>}
          </div>
        )}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-800">Search checklist</h3>
        <CheckList checks={analysis.seo.checks} />
      </section>
      {analysis.readability.checks.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium text-slate-800">Easy to read?</h3>
          <CheckList checks={analysis.readability.checks} />
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-800">When shared on WhatsApp, Facebook or X</h3>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          {(values.socialImageUrl || featuredImageUrl)
            // eslint-disable-next-line @next/next/no-img-element -- social preview
            ? <img src={values.socialImageUrl || featuredImageUrl} alt="" className="aspect-[1.91/1] w-full bg-slate-100 object-cover" />
            : <div className="grid aspect-[1.91/1] w-full place-items-center bg-slate-100 text-xs text-slate-500">Add a featured picture to show one here</div>}
          <div className="bg-slate-50 p-3">
            <div className="text-[11px] uppercase text-slate-500">{host}</div>
            <div className="line-clamp-2 text-sm font-semibold text-slate-900">{googleTitle}</div>
            <div className="line-clamp-2 text-xs text-slate-600">{description}</div>
          </div>
        </div>
      </section>

      <details className="rounded-lg border border-dashed border-slate-300 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">Advanced <span className="font-normal text-slate-500">(rarely needed)</span></summary>
        <div className="mt-3 space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={values.noindex} onChange={(e) => onChange({ noindex: e.target.checked })} className="mt-0.5" />
            <span><span className="font-medium text-slate-800">Hide this {kind} from Google</span><span className="block text-xs text-slate-500">People with the link can still open it.</span></span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-800">Different sharing picture</span>
            <input value={values.socialImageUrl} onChange={(e) => onChange({ socialImageUrl: e.target.value })} placeholder="https://… (uses the featured picture if empty)" className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-800">Original address (canonical)</span>
            <input value={values.canonicalUrl} onChange={(e) => onChange({ canonicalUrl: e.target.value })} placeholder="Only if this was first published somewhere else" className={input} />
          </label>
        </div>
      </details>
    </div>
  );
}
