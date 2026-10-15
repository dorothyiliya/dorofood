import type { ReactNode } from "react";
import Link from "next/link";
import { SignOut } from "@phosphor-icons/react/dist/ssr";
import { BRAND } from "@/lib/brand";
import { requireStaffPage } from "@/lib/admin/session";
import { ROLE_DESCRIPTIONS } from "@/lib/admin/auth";
import { logoutAction } from "@/app/admin/actions/auth";
import { AdminNav } from "@/app/admin/_components/nav";
import { humanise } from "@/app/admin/_components/ui";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaffPage();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex h-full flex-col gap-4 p-3 md:p-4">
          <div className="flex items-center gap-2 px-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand mark */}
            <img src={BRAND.mark.light} alt="" width={34} height={34} />
            <div className="leading-tight">
              <div className="font-display text-sm font-bold">{BRAND.shortName} control</div>
              <Link href="/" className="text-xs text-slate-500 hover:underline">View storefront ↗</Link>
            </div>
          </div>
          <AdminNav />
          <div className="mt-auto hidden rounded-lg bg-slate-50 p-3 text-xs md:block">
            <div className="font-medium text-slate-900">{staff.name}</div>
            <div className="truncate text-slate-500">{staff.email}</div>
            <div className="mt-1 text-slate-600" title={ROLE_DESCRIPTIONS[staff.role]}>{humanise(staff.role)}</div>
            <form action={logoutAction} className="mt-2">
              <button className="inline-flex items-center gap-1.5 text-slate-700 hover:text-red-700"><SignOut size={14} aria-hidden="true" /> Sign out</button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mb-4 flex items-center justify-between text-xs text-slate-500 md:hidden">
          <span>{staff.name} · {humanise(staff.role)}</span>
          <form action={logoutAction}><button className="hover:text-red-700">Sign out</button></form>
        </div>
        {children}
      </main>
    </div>
  );
}
