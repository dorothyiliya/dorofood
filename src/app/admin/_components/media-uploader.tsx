"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UploadSimple } from "@phosphor-icons/react/dist/ssr";
import { uploadMediaAction } from "@/app/admin/actions/content";

/** Upload one or more pictures to the library. */
export function MediaUploader() {
  const ref = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function upload() {
    const files = [...(ref.current?.files ?? [])];
    if (!files.length) { setStatus({ ok: false, text: "Choose one or more pictures first." }); return; }
    start(async () => {
      let done = 0;
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        const res = await uploadMediaAction(form);
        if (!res.ok) { setStatus({ ok: false, text: `${file.name}: ${res.message}` }); break; }
        done++;
        setStatus({ ok: true, text: `Uploaded ${done} of ${files.length}…` });
      }
      if (done === files.length) setStatus({ ok: true, text: `Uploaded ${done} picture${done === 1 ? "" : "s"}.` });
      if (ref.current) ref.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white p-4">
      <UploadSimple size={24} className="text-slate-400" aria-hidden="true" />
      <input ref={ref} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Choose pictures" className="text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-800 hover:file:bg-brand-100" />
      <button type="button" onClick={upload} disabled={pending} className="rounded-md bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:opacity-60">{pending ? "Uploading…" : "Upload"}</button>
      <span className="text-xs text-slate-500">JPEG, PNG or WebP, up to 4 MB each.</span>
      {status && <p role={status.ok ? "status" : "alert"} className={`w-full text-sm ${status.ok ? "text-brand-800" : "text-red-700"}`}>{status.text}</p>}
    </div>
  );
}
