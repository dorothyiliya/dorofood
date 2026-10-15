"use client";

import Link from "next/link";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { ADMIN_PREFIX, rebase, type AdminBase } from "@/lib/admin/paths";

const BaseContext = createContext<AdminBase>(ADMIN_PREFIX);

export function AdminBaseProvider({ base, children }: { base: AdminBase; children: ReactNode }) {
  return <BaseContext.Provider value={base}>{children}</BaseContext.Provider>;
}

export function useAdminBase() {
  return useContext(BaseContext);
}

/** next/link that points "/admin/..." hrefs at the right place for the current host. */
export function AdminLink({ href, ...props }: ComponentProps<typeof Link>) {
  const base = useContext(BaseContext);
  return <Link href={typeof href === "string" ? rebase(href, base) : href} {...props} />;
}
