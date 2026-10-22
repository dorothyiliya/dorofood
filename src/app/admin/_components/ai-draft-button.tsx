"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkle } from "@phosphor-icons/react/dist/ssr";
import { draftDescriptionAction, type DraftState } from "@/app/admin/actions/catalogue";

/**
 * Fills the surrounding form's description with an AI draft built from the
 * fields typed so far. Anything already in the description is passed along as
 * notes. Nothing is saved until staff press Save.
 */
export function AiDraftButton() {
  const ref = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<DraftState>(null);
  const [pending, startTransition] = useTransition();

  function draft() {
    const form = ref.current?.form;
    if (!form) return;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await draftDescriptionAction(null, data);
      setState(result);
      const textarea = form.elements.namedItem("description");
      if (result?.ok && result.text && textarea instanceof HTMLTextAreaElement) {
        textarea.value = result.text;
        textarea.focus();
      }
    });
  }

  return (
    <span className="mt-2 flex flex-wrap items-center gap-3">
      <button ref={ref} type="button" onClick={draft} disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-brand-800 shadow-sm ring-1 ring-inset ring-brand-200 hover:bg-brand-50 disabled:cursor-wait disabled:opacity-60">
        <Sparkle size={14} weight="fill" aria-hidden="true" />
        {pending ? "Writing…" : "Write it for me"}
      </button>
      {state && <span role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-slate-600" : "text-red-700"}`}>{state.message}</span>}
    </span>
  );
}
