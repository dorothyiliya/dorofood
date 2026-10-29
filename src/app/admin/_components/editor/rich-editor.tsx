"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { TextAlign } from "@tiptap/extension-text-align";
import { Youtube } from "@tiptap/extension-youtube";
import { TableKit } from "@tiptap/extension-table";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import {
  ArrowArcLeft, ArrowArcRight, ImageSquare, LinkSimple, ListBullets, ListNumbers, Minus, Quotes, Table, TextAlignCenter,
  TextAlignLeft, TextAlignRight, TextB, TextItalic, TextStrikethrough, TextUnderline, YoutubeLogo, Eraser,
} from "@phosphor-icons/react/dist/ssr";
import { MediaPicker, type PickedImage } from "@/app/admin/_components/editor/media-picker";
import type { DocNode } from "@/lib/content/document";

/**
 * The writing area: a WordPress-style editor built on TipTap. Markdown-style
 * shortcuts also work (## for a heading, - for a list, > for a quote).
 */
export function RichEditor({ initial, onChange, uploads, placeholder = "Start writing here. Use the Picture, Video and Table buttons above to add more." }: {
  initial: DocNode;
  onChange: (json: DocNode) => void;
  uploads: boolean;
  placeholder?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: null, target: null } } }),
      Image.configure({ HTMLAttributes: { loading: "lazy" } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Youtube.configure({ nocookie: true, controls: true, width: 640, height: 360 }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: initial,
    editorProps: { attributes: { class: "article-body min-h-[420px] focus:outline-none", "aria-label": "Post content" } },
    // ProseMirror builds attributes as prototype-less objects, which server actions
    // can't receive; a JSON round trip turns the document into plain data.
    onUpdate: ({ editor: e }) => onChange(JSON.parse(JSON.stringify(e.getJSON())) as DocNode),
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {editor && <Toolbar editor={editor} uploads={uploads} />}
      <div className="px-5 py-6 sm:px-10"><EditorContent editor={editor} /></div>
      {editor && <Footer editor={editor} />}
    </div>
  );
}

function Footer({ editor }: { editor: Editor }) {
  const words = useEditorState({ editor, selector: ({ editor: e }) => e.storage.characterCount.words() as number });
  return <div className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">{words} word{words === 1 ? "" : "s"} · about {Math.max(1, Math.round(words / 220))} min read</div>;
}

function Btn({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={`grid h-9 w-9 place-items-center rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-40 ${active ? "bg-brand-50 text-brand-900 ring-1 ring-inset ring-brand-200" : ""}`}>
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />;

function Toolbar({ editor, uploads }: { editor: Editor; uploads: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : e.isActive("heading", { level: 4 }) ? "h4" : e.isActive("blockquote") ? "quote" : e.isActive("codeBlock") ? "code" : "p",
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      link: e.isActive("link"), bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"),
      center: e.isActive({ textAlign: "center" }), right: e.isActive({ textAlign: "right" }),
      table: e.isActive("table"), canUndo: e.can().undo(), canRedo: e.can().redo(),
    }),
  });
  const [panel, setPanel] = useState<null | "link" | "video">(null);
  const [picking, setPicking] = useState(false);
  const c = () => editor.chain().focus();

  function setBlock(value: string) {
    if (value === "p") c().setParagraph().run();
    else if (value === "quote") c().toggleBlockquote().run();
    else if (value === "code") c().toggleCodeBlock().run();
    else c().toggleHeading({ level: Number(value.slice(1)) as 2 | 3 | 4 }).run();
  }

  function insertImage(img: PickedImage) {
    c().setImage({ src: img.url, alt: img.alt, title: img.caption || undefined }).run();
    setPicking(false);
  }

  return (
    <div className="sticky top-0 z-10 rounded-t-xl border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5" role="toolbar" aria-label="Formatting">
        <Btn label="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => c().undo().run()}><ArrowArcLeft size={18} /></Btn>
        <Btn label="Redo (Ctrl+Shift+Z)" disabled={!s.canRedo} onClick={() => c().redo().run()}><ArrowArcRight size={18} /></Btn>
        <Sep />
        <label className="sr-only" htmlFor="block-style">Text style</label>
        <select id="block-style" value={s.block} onChange={(e) => setBlock(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800">
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
          <option value="h4">Small heading</option>
          <option value="quote">Quote</option>
          <option value="code">Code</option>
        </select>
        <Sep />
        <Btn label="Bold (Ctrl+B)" active={s.bold} onClick={() => c().toggleBold().run()}><TextB size={18} weight="bold" /></Btn>
        <Btn label="Italic (Ctrl+I)" active={s.italic} onClick={() => c().toggleItalic().run()}><TextItalic size={18} /></Btn>
        <Btn label="Underline (Ctrl+U)" active={s.underline} onClick={() => c().toggleUnderline().run()}><TextUnderline size={18} /></Btn>
        <Btn label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()}><TextStrikethrough size={18} /></Btn>
        <Btn label={s.link ? "Edit link" : "Add link (Ctrl+K)"} active={s.link || panel === "link"} onClick={() => setPanel(panel === "link" ? null : "link")}><LinkSimple size={18} /></Btn>
        <Sep />
        <Btn label="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}><ListBullets size={18} /></Btn>
        <Btn label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}><ListNumbers size={18} /></Btn>
        <Btn label="Quote" active={s.block === "quote"} onClick={() => c().toggleBlockquote().run()}><Quotes size={18} /></Btn>
        <Sep />
        <Btn label="Align left" active={!s.center && !s.right} onClick={() => c().setTextAlign("left").run()}><TextAlignLeft size={18} /></Btn>
        <Btn label="Align centre" active={s.center} onClick={() => c().setTextAlign("center").run()}><TextAlignCenter size={18} /></Btn>
        <Btn label="Align right" active={s.right} onClick={() => c().setTextAlign("right").run()}><TextAlignRight size={18} /></Btn>
        <Sep />
        <button type="button" onClick={() => setPicking(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><ImageSquare size={18} /> Picture</button>
        <button type="button" onClick={() => setPanel(panel === "video" ? null : "video")} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><YoutubeLogo size={18} /> Video</button>
        <button type="button" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><Table size={18} /> Table</button>
        <Btn label="Divider line" onClick={() => c().setHorizontalRule().run()}><Minus size={18} /></Btn>
        <Btn label="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()}><Eraser size={18} /></Btn>
      </div>
      {s.table && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-1.5 text-xs">
          <span className="font-medium text-slate-600">Table:</span>
          {([["Add row", () => c().addRowAfter().run()], ["Add column", () => c().addColumnAfter().run()], ["Remove row", () => c().deleteRow().run()], ["Remove column", () => c().deleteColumn().run()], ["Delete table", () => c().deleteTable().run()]] as const).map(([label, fn]) => (
            <button key={label} type="button" onClick={fn} className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50">{label}</button>
          ))}
        </div>
      )}
      {panel === "link" && <LinkPanel editor={editor} onClose={() => setPanel(null)} />}
      {panel === "video" && <VideoPanel editor={editor} onClose={() => setPanel(null)} />}
      {picking && <MediaPicker uploads={uploads} withCaption title="Add a picture" onPick={insertImage} onClose={() => setPicking(false)} />}
      <LinkShortcut editor={editor} open={() => setPanel("link")} />
    </div>
  );
}

function LinkShortcut({ editor, open }: { editor: Editor; open: () => void }) {
  useEffect(() => {
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open(); } };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor, open]);
  return null;
}

function LinkPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = editor.getAttributes("link");
  const [href, setHref] = useState<string>(current.href ?? "");
  const [newTab, setNewTab] = useState<boolean>(current.target === "_blank");
  const hasSelection = !editor.state.selection.empty || editor.isActive("link");

  function apply() {
    const value = href.trim();
    if (!value) { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onClose(); return; }
    const url = /^(https?:|mailto:|tel:|\/|#)/i.test(value) ? value : value.includes("@") ? `mailto:${value}` : `https://${value}`;
    if (hasSelection) editor.chain().focus().extendMarkRange("link").setLink({ href: url, target: newTab ? "_blank" : null }).run();
    else editor.chain().focus().insertContent({ type: "text", text: value, marks: [{ type: "link", attrs: { href: url, target: newTab ? "_blank" : null } }] }).run();
    onClose();
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 bg-slate-50 px-3 py-3 text-sm">
      <label className="flex-1 min-w-[16rem]">
        <span className="mb-1 block text-xs font-medium text-slate-600">Link to</span>
        <input autoFocus value={href} onChange={(e) => setHref(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } if (e.key === "Escape") onClose(); }}
          placeholder="Paste a web address, or /products/… for your own shop" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5" />
      </label>
      <label className="flex items-center gap-2 pb-2 text-xs text-slate-600"><input type="checkbox" checked={newTab} onChange={(e) => setNewTab(e.target.checked)} /> Open in a new tab</label>
      <div className="flex gap-2 pb-0.5">
        <button type="button" onClick={apply} disabled={!href.trim() && !editor.isActive("link")} className="rounded-md bg-brand-800 px-3 py-1.5 font-medium text-white hover:bg-brand-900 disabled:opacity-50">{href.trim() ? (editor.isActive("link") ? "Update link" : "Add link") : editor.isActive("link") ? "Remove link" : "Add link"}</button>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-white">Cancel</button>
      </div>
      {!hasSelection && <p className="w-full text-xs text-slate-500">Tip: select some words first to turn them into a link.</p>}
    </div>
  );
}

function VideoPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  function apply() {
    const ok = editor.chain().focus().setYoutubeVideo({ src: url.trim() }).run();
    if (!ok) { setError("That doesn't look like a YouTube link. Copy it from the Share button on YouTube."); return; }
    onClose();
  }
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 bg-slate-50 px-3 py-3 text-sm">
      <label className="flex-1 min-w-[16rem]">
        <span className="mb-1 block text-xs font-medium text-slate-600">YouTube link</span>
        <input autoFocus value={url} onChange={(e) => { setUrl(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } if (e.key === "Escape") onClose(); }}
          placeholder="https://youtu.be/…" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5" />
      </label>
      <div className="flex gap-2 pb-0.5">
        <button type="button" onClick={apply} className="rounded-md bg-brand-800 px-3 py-1.5 font-medium text-white hover:bg-brand-900">Add video</button>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-white">Cancel</button>
      </div>
      {error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}
