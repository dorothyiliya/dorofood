"use client";

import { startTransition, useActionState, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/lib/admin/action";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

const VARIANTS = {
  primary: "bg-brand-800 text-white hover:bg-brand-900",
  secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
};

/**
 * A form bound to an admin server action, showing the server's result message.
 *
 * Submits through onSubmit rather than the `action` prop: React resets
 * action-prop forms to their *original* defaults after every submission, which
 * would show stale values (e.g. a saved "Active" status reverting to "Draft")
 * and wipe input after a failed save. Here a failed save keeps what was typed,
 * and a successful save remounts the form with the values the server now holds.
 *
 * `confirm` adds a required checkbox for consequential actions instead of a browser dialog.
 */
export function ActionForm({ action, submitLabel, children, variant = "primary", confirm, hidden, className = "", inline = false }: {
  action: Action;
  submitLabel: string;
  children?: ReactNode;
  variant?: keyof typeof VARIANTS;
  confirm?: string;
  hidden?: Record<string, string>;
  className?: string;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [version, setVersion] = useState(0);
  const messageId = useId();

  useEffect(() => {
    if (state?.ok) setVersion((v) => v + 1);
  }, [state]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form key={version} onSubmit={submit} className={`${inline ? "flex flex-wrap items-end gap-3" : "space-y-3"} ${className}`} aria-describedby={state ? messageId : undefined} aria-busy={pending}>
      {hidden && Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {children}
      {confirm && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" required className="mt-0.5" />
          <span>{confirm}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium shadow-sm disabled:cursor-wait disabled:opacity-60 ${VARIANTS[variant]}`}>
          {pending ? "Working…" : submitLabel}
        </button>
        {state && (
          <p id={messageId} key={state.at} role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-brand-800" : "text-red-700"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
