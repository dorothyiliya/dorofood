import type { Rendered } from "@/lib/content/document";

/**
 * Search and readability checks in plain language, in the spirit of Yoast.
 * Pure functions: the editor runs them live as people type, and the server
 * stores the scores so lists can show them.
 */

export type CheckStatus = "good" | "ok" | "bad";
export type Check = { id: string; status: CheckStatus; message: string };
export type Analysis = { seo: { score: number; checks: Check[] }; readability: { score: number; checks: Check[] } };

export type SeoInput = {
  kind: "post" | "page" | "product";
  keyphrase: string;
  /** The title as it will appear on Google (pattern applied). */
  seoTitle: string;
  slug: string;
  metaDescription: string;
  rendered: Pick<Rendered, "text" | "wordCount" | "headings" | "links" | "images" | "paragraphs">;
  hasFeaturedImage?: boolean;
  /** Keyphrases already used by other posts and pages. */
  otherKeyphrases?: string[];
};

export const TITLE_RANGE = [30, 60] as const;
export const DESCRIPTION_RANGE = [120, 160] as const;

const normalise = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'");
const words = (s: string) => normalise(s).match(/[\p{L}\p{N}']+/gu) ?? [];

/** Exact phrase present, or failing that, every word of it present. */
function match(haystack: string, keyphrase: string): "exact" | "words" | null {
  const h = ` ${words(haystack).join(" ")} `;
  const k = words(keyphrase);
  if (!k.length) return null;
  if (h.includes(` ${k.join(" ")} `)) return "exact";
  const set = new Set(words(haystack));
  return k.every((w) => set.has(w)) ? "words" : null;
}

function occurrences(text: string, keyphrase: string) {
  const h = ` ${words(text).join(" ")} `;
  const k = ` ${words(keyphrase).join(" ")} `;
  if (k.trim() === "") return 0;
  let count = 0;
  for (let i = h.indexOf(k); i !== -1; i = h.indexOf(k, i + k.length - 1)) count++;
  return count;
}

export function sentences(text: string) {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => words(s).length > 0);
}

function syllables(word: string) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length);
}

/** Flesch reading ease (0-100, higher is easier). */
export function readingEase(text: string) {
  const s = sentences(text);
  const w = words(text);
  if (!s.length || !w.length) return null;
  const syl = w.reduce((n, x) => n + syllables(x), 0);
  return Math.round(Math.max(0, Math.min(100, 206.835 - 1.015 * (w.length / s.length) - 84.6 * (syl / w.length))));
}

const score = (checks: Check[]) => (checks.length ? Math.round(checks.reduce((n, c) => n + (c.status === "good" ? 100 : c.status === "ok" ? 50 : 0), 0) / checks.length) : 0);

export function scoreLabel(n: number | null | undefined): { label: string; tone: CheckStatus } {
  if (n === null || n === undefined) return { label: "Not checked", tone: "ok" };
  return n >= 70 ? { label: "Good", tone: "good" } : n >= 40 ? { label: "OK", tone: "ok" } : { label: "Needs work", tone: "bad" };
}

export function analyse(input: SeoInput): Analysis {
  const seo: Check[] = [];
  const kp = input.keyphrase.trim();
  const { text, wordCount, headings, links, images, paragraphs } = input.rendered;
  const thing = input.kind === "product" ? "product" : input.kind === "page" ? "page" : "post";

  if (!kp) {
    seo.push({ id: "keyphrase", status: "bad", message: `Add a focus keyphrase: the words people would type into Google to find this ${thing}, e.g. "jollof rice recipe".` });
  } else {
    if (input.otherKeyphrases?.some((o) => normalise(o.trim()) === normalise(kp))) {
      seo.push({ id: "keyphrase-unique", status: "bad", message: "You already used this keyphrase on another post or page. Choose a different one so they don't compete with each other on Google." });
    }
    const inTitle = match(input.seoTitle, kp);
    const startsTitle = words(input.seoTitle).slice(0, words(kp).length + 2).join(" ").includes(words(kp).join(" "));
    seo.push(inTitle === "exact"
      ? { id: "keyphrase-title", status: "good", message: startsTitle ? "The keyphrase is at the start of the title. Great." : "The keyphrase is in the title. Even better near the start." }
      : inTitle === "words"
        ? { id: "keyphrase-title", status: "ok", message: "The title has the words of your keyphrase, but not together. Try using the exact phrase." }
        : { id: "keyphrase-title", status: "bad", message: "Put the keyphrase in the title, ideally near the start." });
    seo.push(match(input.metaDescription, kp)
      ? { id: "keyphrase-description", status: "good", message: "The keyphrase is in the Google description." }
      : { id: "keyphrase-description", status: "bad", message: "Use the keyphrase in the Google description (the short text under the title on Google)." });
    seo.push(match(input.slug.replace(/-/g, " "), kp)
      ? { id: "keyphrase-slug", status: "good", message: "The web address contains the keyphrase." }
      : { id: "keyphrase-slug", status: "ok", message: "Put the keyphrase words in the web address." });
    if (input.kind !== "product") {
      seo.push(paragraphs[0] && match(paragraphs[0], kp)
        ? { id: "keyphrase-intro", status: "good", message: "The keyphrase appears in the first paragraph." }
        : { id: "keyphrase-intro", status: "bad", message: "Mention the keyphrase in your first paragraph, so readers and Google know straight away what this is about." });
      const count = occurrences(text, kp);
      const density = wordCount ? (count * words(kp).length * 100) / wordCount : 0;
      seo.push(count === 0
        ? { id: "keyphrase-density", status: "bad", message: "The keyphrase doesn't appear in the text yet. Use it a few times where it reads naturally." }
        : wordCount < 100
          ? { id: "keyphrase-density", status: "ok", message: "Keep writing. Once there are 100 words we'll check how often the keyphrase is used." }
        : density > 3
          ? { id: "keyphrase-density", status: "bad", message: `The keyphrase is used ${count} times, which is too often. Google may see that as stuffing; use it less.` }
          : wordCount >= 200 && density < 0.5
            ? { id: "keyphrase-density", status: "ok", message: `The keyphrase is used ${count} time${count === 1 ? "" : "s"}. Use it a little more for a text this long.` }
            : { id: "keyphrase-density", status: "good", message: `The keyphrase is used ${count} time${count === 1 ? "" : "s"}. That's about right.` });
      const subheads = headings.filter((h) => h.level <= 3);
      if (subheads.length) {
        seo.push(subheads.some((h) => match(h.text, kp))
          ? { id: "keyphrase-subheading", status: "good", message: "A subheading includes the keyphrase." }
          : { id: "keyphrase-subheading", status: "ok", message: "Use the keyphrase (or its words) in at least one subheading." });
      }
      if (images.length) {
        seo.push(images.some((i) => match(i.alt, kp))
          ? { id: "keyphrase-image", status: "good", message: "An image description includes the keyphrase." }
          : { id: "keyphrase-image", status: "ok", message: "Describe at least one image using the keyphrase (the image's alt text)." });
      }
    }
  }

  const titleLength = input.seoTitle.trim().length;
  seo.push(titleLength < TITLE_RANGE[0]
    ? { id: "title-length", status: "ok", message: `The Google title is short (${titleLength} characters). Use more of the space, up to about ${TITLE_RANGE[1]}.` }
    : titleLength > TITLE_RANGE[1]
      ? { id: "title-length", status: "ok", message: `The Google title is ${titleLength} characters, so Google may cut it off. Aim for ${TITLE_RANGE[1]} or fewer.` }
      : { id: "title-length", status: "good", message: "The Google title is a good length." });

  const d = input.metaDescription.trim().length;
  seo.push(d === 0
    ? { id: "description", status: "bad", message: "Write a Google description: one or two sentences that make people want to click." }
    : d < DESCRIPTION_RANGE[0]
      ? { id: "description", status: "ok", message: `The Google description is short (${d} characters). Aim for ${DESCRIPTION_RANGE[0]}-${DESCRIPTION_RANGE[1]}.` }
      : d > DESCRIPTION_RANGE[1]
        ? { id: "description", status: "ok", message: `The Google description is ${d} characters; Google may cut it off after about ${DESCRIPTION_RANGE[1]}.` }
        : { id: "description", status: "good", message: "The Google description is a good length." });

  if (input.kind !== "product") {
    const [good, ok] = input.kind === "post" ? [600, 300] : [250, 100];
    seo.push(wordCount >= good
      ? { id: "length", status: "good", message: `${wordCount} words. A good length.` }
      : wordCount >= ok
        ? { id: "length", status: "ok", message: `${wordCount} words. Longer, useful ${thing}s tend to do better; aim for ${good}+.` }
        : { id: "length", status: "bad", message: `Only ${wordCount} words. Write at least ${ok}, ideally ${good}+, so Google has something to show.` });
    seo.push(links.some((l) => l.internal)
      ? { id: "internal-links", status: "good", message: "Links to other pages on your site. Good for readers and Google." }
      : { id: "internal-links", status: "ok", message: "Link to another page on your site, such as a product or another post." });
    seo.push(links.some((l) => !l.internal)
      ? { id: "outbound-links", status: "good", message: "Links to other websites, which shows where facts come from." }
      : { id: "outbound-links", status: "ok", message: "Consider linking to a trustworthy website where it helps the reader." });
    const missingAlt = images.filter((i) => !i.alt.trim()).length;
    seo.push(!images.length && !input.hasFeaturedImage
      ? { id: "images", status: "ok", message: "Add at least one photo. Posts with pictures get more clicks." }
      : missingAlt
        ? { id: "images", status: "ok", message: `${missingAlt} image${missingAlt === 1 ? " has" : "s have"} no description (alt text). Describe each image in a few words.` }
        : { id: "images", status: "good", message: "Images are described for search engines and screen readers." });
  }

  const readability: Check[] = [];
  if (input.kind !== "product" && wordCount >= 50) {
    const s = sentences(text);
    const long = s.filter((x) => words(x).length > 20).length;
    const longShare = s.length ? (long * 100) / s.length : 0;
    readability.push(longShare <= 25
      ? { id: "sentence-length", status: "good", message: "Sentences are a comfortable length." }
      : longShare <= 30
        ? { id: "sentence-length", status: "ok", message: `${Math.round(longShare)}% of sentences are long (over 20 words). Try splitting a few.` }
        : { id: "sentence-length", status: "bad", message: `${Math.round(longShare)}% of sentences are long (over 20 words). Split some into two.` });
    const longParas = paragraphs.filter((p) => words(p).length > 150).length;
    readability.push(longParas === 0
      ? { id: "paragraph-length", status: "good", message: "Paragraphs are short and easy to scan." }
      : { id: "paragraph-length", status: longParas > 1 ? "bad" : "ok", message: `${longParas} paragraph${longParas === 1 ? " is" : "s are"} very long (over 150 words). Break ${longParas === 1 ? "it" : "them"} up.` });
    if (wordCount > 300) {
      readability.push(headings.length === 0
        ? { id: "subheadings", status: "bad", message: "Add subheadings to break the text into sections. People scan before they read." }
        : { id: "subheadings", status: "good", message: "Subheadings break the text into easy sections." });
    }
    const ease = readingEase(text);
    if (ease !== null) {
      readability.push(ease >= 60
        ? { id: "reading-ease", status: "good", message: `Easy to read (score ${ease}/100).` }
        : ease >= 50
          ? { id: "reading-ease", status: "ok", message: `Fairly hard to read (score ${ease}/100). Shorter sentences and simpler words help.` }
          : { id: "reading-ease", status: "bad", message: `Hard to read (score ${ease}/100). Use shorter sentences and everyday words.` });
    }
    const starts = s.map((x) => words(x)[0]);
    let run = 1, worst = 1;
    for (let i = 1; i < starts.length; i++) { run = starts[i] && starts[i] === starts[i - 1] ? run + 1 : 1; worst = Math.max(worst, run); }
    readability.push(worst >= 3
      ? { id: "sentence-starts", status: "ok", message: `${worst} sentences in a row start with the same word. Vary how sentences begin.` }
      : { id: "sentence-starts", status: "good", message: "Sentences start in varied ways." });
  }

  return { seo: { score: score(seo), checks: seo }, readability: { score: score(readability), checks: readability } };
}
