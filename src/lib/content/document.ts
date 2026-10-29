/**
 * Blog and page content. The editor (TipTap) saves a JSON document; this module
 * is the only thing that turns that JSON into HTML for the public site. It is
 * an allowlist: unknown blocks and formatting are dropped, links must be
 * http(s), mailto, tel or on-site, images must be https, and video embeds must
 * be YouTube. Pure TypeScript, so the editor uses the same code for its live
 * SEO analysis.
 */

export type DocNode = { type?: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string; marks?: DocMark[] };
export type DocMark = { type: string; attrs?: Record<string, unknown> };

export type Rendered = {
  html: string;
  text: string;
  wordCount: number;
  headings: { level: number; text: string; id: string }[];
  links: { href: string; internal: boolean; text: string }[];
  images: { src: string; alt: string }[];
  paragraphs: string[];
};

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

const MAX_DEPTH = 40;
const ALIGN = new Set(["left", "center", "right", "justify"]);

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function slugifyText(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

/** Links staff may add: web, email and phone links, and on-site paths. */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  if (!href || href.length > 2000) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safeImageSrc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const src = raw.trim();
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  try {
    const url = new URL(src);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function youtubeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1);
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = url.searchParams.get("v") ?? (/^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null);
    }
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function isInternal(href: string, siteOrigin?: string) {
  if (href.startsWith("/") || href.startsWith("#")) return true;
  if (!siteOrigin) return false;
  try {
    const a = new URL(href).hostname.replace(/^www\./, "");
    const b = new URL(siteOrigin).hostname.replace(/^www\./, "");
    return a === b;
  } catch {
    return false;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Returns a cleaned copy of the document containing only supported, safe content. */
export function sanitizeDoc(input: unknown): DocNode {
  const clean = (node: unknown, depth: number): DocNode | null => {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
    const n = node as DocNode;
    const kids = () => (Array.isArray(n.content) ? n.content.map((c) => clean(c, depth + 1)).filter((c): c is DocNode => c !== null) : []);
    const align = (attrs?: Record<string, unknown>) => (ALIGN.has(str(attrs?.textAlign)) && attrs?.textAlign !== "left" ? { textAlign: attrs!.textAlign } : {});
    switch (n.type) {
      case "doc": return { type: "doc", content: kids() };
      case "paragraph": return { type: "paragraph", attrs: align(n.attrs), content: kids() };
      case "heading": return { type: "heading", attrs: { level: Math.min(4, Math.max(2, int(n.attrs?.level, 1, 6) ?? 2)), ...align(n.attrs) }, content: kids() };
      case "text": {
        const text = str(n.text);
        if (!text) return null;
        const marks = (Array.isArray(n.marks) ? n.marks : []).flatMap((m): DocMark[] => {
          if (!m || typeof m !== "object") return [];
          if (["bold", "italic", "underline", "strike", "code"].includes(m.type)) return [{ type: m.type }];
          if (m.type === "link") {
            const href = safeHref(m.attrs?.href);
            return href ? [{ type: "link", attrs: { href, target: m.attrs?.target === "_blank" ? "_blank" : null } }] : [];
          }
          return [];
        });
        return { type: "text", text, ...(marks.length ? { marks } : {}) };
      }
      case "hardBreak": case "horizontalRule": return { type: n.type };
      case "bulletList": case "listItem": case "blockquote": case "tableRow": return { type: n.type, content: kids() };
      case "orderedList": return { type: "orderedList", attrs: { start: int(n.attrs?.start, 1, 100000) ?? 1 }, content: kids() };
      case "codeBlock": return { type: "codeBlock", content: kids().filter((k) => k.type === "text").map((k) => ({ type: "text", text: k.text })) };
      case "image": {
        const src = safeImageSrc(n.attrs?.src);
        return src ? { type: "image", attrs: { src, alt: str(n.attrs?.alt).slice(0, 300), title: str(n.attrs?.title).slice(0, 300) || null } } : null;
      }
      case "youtube": {
        const id = youtubeId(n.attrs?.src);
        return id ? { type: "youtube", attrs: { src: `https://www.youtube.com/watch?v=${id}` } } : null;
      }
      case "table": return { type: "table", content: kids().filter((k) => k.type === "tableRow") };
      case "tableHeader": case "tableCell":
        return { type: n.type, attrs: { colspan: int(n.attrs?.colspan, 1, 20) ?? 1, rowspan: int(n.attrs?.rowspan, 1, 50) ?? 1 }, content: kids() };
      default: {
        // Unknown block: keep its text so nothing typed is lost.
        const inner = kids();
        return inner.length ? { type: "paragraph", content: inner.filter((k) => k.type === "text" || k.type === "hardBreak") } : null;
      }
    }
  };
  const doc = clean(input, 0);
  return doc?.type === "doc" && doc.content?.length ? doc : EMPTY_DOC;
}

/** Renders a sanitised document to HTML, plus the facts the SEO checker needs. */
export function renderDoc(input: unknown, options: { siteOrigin?: string } = {}): Rendered {
  const doc = sanitizeDoc(input);
  const headings: Rendered["headings"] = [];
  const links: Rendered["links"] = [];
  const images: Rendered["images"] = [];
  const paragraphs: string[] = [];
  const blocks: string[] = [];
  const usedIds = new Set<string>();

  const plain = (node: DocNode): string => node.type === "text" ? str(node.text) : node.type === "hardBreak" ? "\n" : (node.content ?? []).map(plain).join("");

  const inline = (nodes: DocNode[] = []): string => nodes.map((n) => {
    if (n.type === "hardBreak") return "<br>";
    if (n.type !== "text") return "";
    let html = escapeHtml(str(n.text));
    const marks = n.marks ?? [];
    for (const m of marks) {
      if (m.type === "bold") html = `<strong>${html}</strong>`;
      else if (m.type === "italic") html = `<em>${html}</em>`;
      else if (m.type === "underline") html = `<u>${html}</u>`;
      else if (m.type === "strike") html = `<s>${html}</s>`;
      else if (m.type === "code") html = `<code>${html}</code>`;
    }
    const link = marks.find((m) => m.type === "link");
    if (link) {
      const href = str(link.attrs?.href);
      const internal = isInternal(href, options.siteOrigin);
      links.push({ href, internal, text: str(n.text) });
      const newTab = link.attrs?.target === "_blank";
      html = `<a href="${escapeHtml(href)}"${newTab ? ' target="_blank"' : ""}${internal ? "" : ' rel="noopener noreferrer"'}>${html}</a>`;
    }
    return html;
  }).join("");

  const style = (attrs?: Record<string, unknown>) => (attrs?.textAlign ? ` style="text-align:${escapeHtml(str(attrs.textAlign))}"` : "");

  const block = (n: DocNode): string => {
    switch (n.type) {
      case "paragraph": {
        const text = plain(n).trim();
        if (text) paragraphs.push(text);
        return `<p${style(n.attrs)}>${inline(n.content)}</p>`;
      }
      case "heading": {
        const level = Number(n.attrs?.level) || 2;
        const text = plain(n).trim();
        let id = slugifyText(text) || "section";
        for (let i = 2; usedIds.has(id); i++) id = `${slugifyText(text) || "section"}-${i}`;
        usedIds.add(id);
        headings.push({ level, text, id });
        return `<h${level} id="${id}"${style(n.attrs)}>${inline(n.content)}</h${level}>`;
      }
      case "bulletList": return `<ul>${(n.content ?? []).map(block).join("")}</ul>`;
      case "orderedList": {
        const start = Number(n.attrs?.start) || 1;
        return `<ol${start !== 1 ? ` start="${start}"` : ""}>${(n.content ?? []).map(block).join("")}</ol>`;
      }
      case "listItem": return `<li>${(n.content ?? []).map(block).join("")}</li>`;
      case "blockquote": return `<blockquote>${(n.content ?? []).map(block).join("")}</blockquote>`;
      case "codeBlock": return `<pre><code>${escapeHtml(plain(n))}</code></pre>`;
      case "horizontalRule": return "<hr>";
      case "image": {
        const src = str(n.attrs?.src);
        const alt = str(n.attrs?.alt);
        images.push({ src, alt });
        const caption = str(n.attrs?.title);
        const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
        return caption ? `<figure>${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>` : `<figure>${img}</figure>`;
      }
      case "youtube": {
        const id = youtubeId(n.attrs?.src);
        return id ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube video" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : "";
      }
      case "table": return `<div class="table-scroll"><table><tbody>${(n.content ?? []).map(block).join("")}</tbody></table></div>`;
      case "tableRow": return `<tr>${(n.content ?? []).map(block).join("")}</tr>`;
      case "tableHeader": case "tableCell": {
        const tag = n.type === "tableHeader" ? "th" : "td";
        const span = `${Number(n.attrs?.colspan) > 1 ? ` colspan="${Number(n.attrs?.colspan)}"` : ""}${Number(n.attrs?.rowspan) > 1 ? ` rowspan="${Number(n.attrs?.rowspan)}"` : ""}`;
        return `<${tag}${span}>${(n.content ?? []).map(block).join("")}</${tag}>`;
      }
      default: return "";
    }
  };

  for (const n of doc.content ?? []) blocks.push(block(n));
  const text = (doc.content ?? []).map((n) => plain(n).trim()).filter(Boolean).join("\n\n");
  return {
    html: blocks.join("\n"),
    text,
    wordCount: countWords(text),
    headings,
    links,
    images,
    paragraphs,
  };
}

export function countWords(text: string) {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

export function readingMinutes(wordCount: number) {
  return Math.max(1, Math.round(wordCount / 220));
}
