"use client";

import { useState, type FormEvent } from "react";
import { loginAction } from "@/app/admin/actions/auth";
import { rebase, type AdminBase } from "@/lib/admin/paths";

const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20";

export function LoginForm({ next, base }: { next: string; base: AdminBase }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  // Navigation happens here, after the action resolves, rather than in an effect:
  // the sign-in refreshes this page into its signed-in state, which unmounts the form.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await loginAction(null, new FormData(event.currentTarget));
    if (result?.ok && result.redirectTo) {
      window.location.assign(rebase(result.redirectTo, base));
      return;
    }
    setError(result?.message ?? "Something went wrong. Please try again.");
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Email</span>
        <input name="email" type="email" autoComplete="username" required className={input} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-brand-800 px-3 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
