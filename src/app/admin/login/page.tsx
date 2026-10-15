import type { Metadata } from "next";
import { adminBase, currentStaff } from "@/lib/admin/session";
import { rebase } from "@/lib/admin/paths";
import { BRAND } from "@/lib/brand";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // No server redirect here: this page is re-rendered inside the sign-in action's
  // response, where a redirect would bypass the admin-host path mapping.
  const [staff, base, params] = await Promise.all([currentStaff(), adminBase(), searchParams]);
  const next = typeof params.next === "string" ? params.next : "";
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand mark */}
          <img src={BRAND.mark.light} alt="" width={44} height={44} />
          <div>
            <h1 className="font-display text-lg font-bold">{BRAND.shortName} control</h1>
            <p className="text-xs text-slate-500">Staff sign in</p>
          </div>
        </div>
        {staff ? (
          <div className="space-y-3 text-sm">
            <p>You are signed in as <strong>{staff.name}</strong>.</p>
            <a href={rebase("/admin", base)} className="inline-block rounded-md bg-brand-800 px-3 py-2 font-medium text-white hover:bg-brand-900">Go to the dashboard</a>
          </div>
        ) : <LoginForm next={next} base={base} />}
      </div>
    </main>
  );
}
