"use server";

import { headers } from "next/headers";
import { login, logout } from "@/lib/admin/auth";
import { clearSessionCookie, setSessionCookie } from "@/lib/admin/session";
import type { ActionState } from "@/lib/admin/action";
import { text } from "@/lib/admin/form";

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = text(form, "email", 254);
  const password = typeof form.get("password") === "string" ? (form.get("password") as string).slice(0, 200) : "";
  if (!email || !password) return { ok: false, message: "Enter your email and password.", at: Date.now() };
  const result = await login(email, password, (await headers()).get("user-agent"));
  if (!result.ok) return { ok: false, message: result.error, at: Date.now() };
  await setSessionCookie(result.token, result.expiresAt);
  const next = text(form, "next", 200);
  // Accept a return path from either routing mode; never an external or protocol-relative URL.
  const safe = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(next) ? next : "/admin";
  return { ok: true, message: "Signed in.", at: Date.now(), redirectTo: safe.startsWith("/admin") ? safe : `/admin${safe === "/" ? "" : safe}` };
}

export async function logoutAction() {
  await logout(await clearSessionCookie());
}
