"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction } from "@/app/admin/actions/auth";

const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20";

function Submit() {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="w-full rounded-md bg-brand-800 px-3 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>;
}

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Email</span>
        <input name="email" type="email" autoComplete="username" required className={input} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      {state && !state.ok && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
      <Submit />
    </form>
  );
}
