import { describe, expect, it } from "vitest";
import { countWords, renderDoc, safeHref, sanitizeDoc, youtubeId, type DocNode } from "@/lib/content/document";
import { analyse, readingEase } from "@/lib/seo/analysis";
import { applyTitlePattern } from "@/lib/seo/title";
import { can } from "@/lib/admin/auth";

const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const t = (text: string, marks?: DocNode["marks"]): DocNode => ({ type: "text", text, ...(marks ? { marks } : {}) });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });

describe("content rendering is an allowlist", () => {
  it("escapes text, so typed HTML can never run", () => {
    const { html } = renderDoc(doc(p(t('<script>alert(1)</script> & "quotes"'))));
    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p>");
  });

  it("drops dangerous links but keeps the words", () => {
    const { html, links } = renderDoc(doc(p(
      t("bad", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]), t(" "),
      t("data", [{ type: "link", attrs: { href: "data:text/html,<b>x</b>" } }]), t(" "),
      t("ok", [{ type: "link", attrs: { href: "https://example.com/a?b=1&c=2", target: "_blank" } }]), t(" "),
      t("shop", [{ type: "link", attrs: { href: "/products/chips" } }]),
    )), { siteOrigin: "https://www.dorocityfoods.com" });
    expect(html).not.toMatch(/javascript:|data:/);
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ok</a>');
    expect(html).toContain('<a href="/products/chips">shop</a>');
    expect(links).toEqual([{ href: "https://example.com/a?b=1&c=2", internal: false, text: "ok" }, { href: "/products/chips", internal: true, text: "shop" }]);
  });

  it("only allows https images, escapes their descriptions, and only YouTube videos", () => {
    const { html, images } = renderDoc(doc(
      { type: "image", attrs: { src: "http://evil.example/x.png", alt: "x" } },
      { type: "image", attrs: { src: "https://img.example/a.jpg", alt: 'A "quoted" <b>alt</b>', title: "Caption" } },
      { type: "youtube", attrs: { src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } },
      { type: "youtube", attrs: { src: "https://evil.example/embed/x" } },
      { type: "iframe", attrs: { src: "https://evil.example" } },
    ));
    expect(images).toEqual([{ src: "https://img.example/a.jpg", alt: 'A "quoted" <b>alt</b>' }]);
    expect(html).toContain('alt="A &quot;quoted&quot; &lt;b&gt;alt&lt;/b&gt;"');
    expect(html).toContain("<figcaption>Caption</figcaption>");
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).not.toContain("evil.example");
  });

  it("clamps headings below the title, gives them unique anchors, and allowlists alignment", () => {
    const { html, headings } = renderDoc(doc(
      { type: "heading", attrs: { level: 1 }, content: [t("Ingredients")] },
      { type: "heading", attrs: { level: 3 }, content: [t("Ingredients")] },
      { type: "paragraph", attrs: { textAlign: "center;background:url(x)" }, content: [t("hi")] },
      { type: "paragraph", attrs: { textAlign: "center" }, content: [t("hi")] },
    ));
    expect(headings).toEqual([{ level: 2, text: "Ingredients", id: "ingredients" }, { level: 3, text: "Ingredients", id: "ingredients-2" }]);
    expect(html).not.toContain("url(x)");
    expect(html).toContain('<p style="text-align:center">hi</p>');
  });

  it("keeps the text of unknown blocks and never returns an empty document", () => {
    expect(renderDoc(doc({ type: "mystery", content: [t("kept")] })).text).toBe("kept");
    expect(sanitizeDoc(null)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(sanitizeDoc({ type: "doc", content: "nope" })).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("helpers", () => {
    expect(safeHref("mailto:hello@example.com")).toBe("mailto:hello@example.com");
    expect(safeHref("//evil.example")).toBeNull();
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(countWords("Jollof rice, the party’s favourite!")).toBe(5);
    expect(applyTitlePattern("Chips", "{title} | Dorocity Foods")).toBe("Chips | Dorocity Foods");
  });
});

describe("SEO checks", () => {
  const body = (text: string) => renderDoc(doc(...text.split("\n\n").map((para) => p(t(para)))), { siteOrigin: "https://www.dorocityfoods.com" });
  const base = { kind: "post" as const, keyphrase: "jollof rice", slug: "smoky-jollof-rice", seoTitle: "Smoky jollof rice at home | Dorocity Foods", metaDescription: "How to cook smoky party jollof rice at home with simple ingredients, a heavy pot and a little patience. Step by step, with tips." };
  const status = (checks: { id: string; status: string }[], id: string) => checks.find((c) => c.id === id)?.status;

  it("rewards a keyphrase used in the right places", () => {
    const text = `Jollof rice is the star of every party. ${"Rice is simple to cook. ".repeat(60)}\n\nThis jollof rice needs time.`;
    const a = analyse({ ...base, rendered: body(text) });
    for (const id of ["keyphrase-title", "keyphrase-description", "keyphrase-slug", "keyphrase-intro", "description"]) expect(status(a.seo.checks, id)).toBe("good");
    expect(a.seo.score).toBeGreaterThan(60);
  });

  it("flags missing and overused keyphrases, reuse, and thin content", () => {
    expect(status(analyse({ ...base, keyphrase: "", rendered: body("Short text.") }).seo.checks, "keyphrase")).toBe("bad");
    const stuffed = analyse({ ...base, rendered: body("Jollof rice is good. ".repeat(30)) });
    expect(status(stuffed.seo.checks, "keyphrase-density")).toBe("bad");
    expect(status(stuffed.seo.checks, "length")).toBe("bad");
    expect(status(analyse({ ...base, rendered: body("Jollof rice."), otherKeyphrases: ["Jollof Rice"] }).seo.checks, "keyphrase-unique")).toBe("bad");
    // Short drafts aren't judged on keyphrase frequency yet.
    expect(status(analyse({ ...base, rendered: body("Jollof rice, jollof rice.") }).seo.checks, "keyphrase-density")).toBe("ok");
  });

  it("checks readability in plain terms", () => {
    const long = "This sentence keeps going and going with many words so that it is far longer than twenty words which makes it hard to read for most people today.";
    const a = analyse({ ...base, rendered: body(Array.from({ length: 8 }, () => long).join(" ")) });
    expect(status(a.readability.checks, "sentence-length")).toBe("bad");
    expect(readingEase("The cat sat on the mat. It was warm.")).toBeGreaterThan(80);
  });
});

describe("roles", () => {
  it("editors write content and manage SEO, but can't touch orders or products", () => {
    expect(can("EDITOR", "content.manage")).toBe(true);
    expect(can("EDITOR", "seo.manage")).toBe(true);
    expect(can("EDITOR", "catalogue.manage")).toBe(false);
    expect(can("EDITOR", "refunds.manage")).toBe(false);
    expect(can("CATALOGUE", "content.manage")).toBe(true);
  });
});
