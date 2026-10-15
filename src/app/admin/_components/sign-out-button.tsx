"use client";

import { useTransition } from "react";
import { SignOut } from "@phosphor-icons/react/dist/ssr";
import { logoutAction } from "@/app/admin/actions/auth";
import { rebase } from "@/lib/admin/paths";
import { useAdminBase } from "@/app/admin/_components/admin-link";

/** Ends the session on the server, then loads the sign-in page through the middleware. */
export function SignOutButton({ className = "", icon = false }: { className?: string; icon?: boolean }) {
  const base = useAdminBase();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} className={className}
      onClick={() => start(async () => { await logoutAction(); window.location.assign(rebase("/admin/login", base)); })}>
      {icon && <SignOut size={14} aria-hidden="true" />} {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
