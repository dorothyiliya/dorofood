import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/admin/session";
import { BRAND } from "@/lib/brand";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await currentStaff()) redirect("/admin");
  const params = await searchParams;
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
        <LoginForm next={next} />
      </div>
    </main>
  );
}
