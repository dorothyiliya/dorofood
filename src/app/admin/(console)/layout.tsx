import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { getAppBaseUrl } from "@/lib/env";
import { adminBase, requireStaffPage } from "@/lib/admin/session";
import { AdminBaseProvider } from "@/app/admin/_components/admin-link";
import { ROLE_DESCRIPTIONS } from "@/lib/admin/auth";
import { SignOutButton } from "@/app/admin/_components/sign-out-button";
import { AdminNav } from "@/app/admin/_components/nav";
import { humanise } from "@/app/admin/_components/ui";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaffPage();
  const base = await adminBase();
  let storefront = "/";
  try { storefront = getAppBaseUrl(); } catch { /* local development without APP_BASE_URL */ }
  return (
    <AdminBaseProvider base={base}>
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex h-full flex-col gap-4 p-3 md:p-4">
          <div className="flex items-center gap-2 px-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand mark */}
            <img src={BRAND.mark.light} alt="" width={34} height={34} />
            <div className="leading-tight">
              <div className="font-display text-sm font-bold">{BRAND.shortName} control</div>
              <a href={storefront} className="text-xs text-slate-500 hover:underline">View storefront ↗</a>
            </div>
          </div>
          <AdminNav />
          <div className="mt-auto hidden rounded-lg bg-slate-50 p-3 text-xs md:block">
            <div className="font-medium text-slate-900">{staff.name}</div>
            <div className="truncate text-slate-500">{staff.email}</div>
            <div className="mt-1 text-slate-600" title={ROLE_DESCRIPTIONS[staff.role]}>{humanise(staff.role)}</div>
            <SignOutButton icon className="mt-2 inline-flex items-center gap-1.5 text-slate-700 hover:text-red-700" />
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mb-4 flex items-center justify-between text-xs text-slate-500 md:hidden">
          <span>{staff.name} · {humanise(staff.role)}</span>
          <SignOutButton className="hover:text-red-700" />
        </div>
        {children}
      </main>
    </div>
    </AdminBaseProvider>
  );
}
