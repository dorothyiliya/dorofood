import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, SESSION_COOKIE, staffForToken, type Permission, type SessionStaff } from "@/lib/admin/auth";
import { CommerceError } from "@/lib/commerce/errors";
import { ADMIN_PREFIX, rebase, type AdminBase } from "@/lib/admin/paths";

/** "" on the dedicated admin host (ADMIN_HOST), "/admin" everywhere else. */
export async function adminBase(): Promise<AdminBase> {
  const adminHost = process.env.ADMIN_HOST?.trim().toLowerCase();
  const host = (await headers()).get("host")?.toLowerCase().split(":")[0];
  return adminHost && host === adminHost ? "" : ADMIN_PREFIX;
}

/**
 * redirect() for internal "/admin/..." paths, rewritten for the current host.
 * Inside a server action's response Next.js renders the redirect target
 * internally, without the middleware, so the internal path is used there.
 */
export async function adminRedirect(path: string): Promise<never> {
  const inAction = (await headers()).has("next-action");
  redirect(inAction ? path : rebase(path, await adminBase()));
}

/** The signed-in staff member for this request, or null. */
export async function currentStaff(): Promise<SessionStaff | null> {
  const store = await cookies();
  return staffForToken(store.get(SESSION_COOKIE)?.value);
}

/** For pages: sends anonymous visitors to the login page. */
export async function requireStaffPage(): Promise<SessionStaff> {
  const staff = await currentStaff();
  if (!staff) return adminRedirect("/admin/login");
  return staff;
}

export class SessionExpiredError extends Error {
  constructor() {
    super("SESSION_EXPIRED");
    this.name = "SessionExpiredError";
  }
}

/** For server actions: every mutation re-checks the session and the permission. */
export async function requireStaff(permission: Permission): Promise<SessionStaff> {
  const staff = await currentStaff();
  if (!staff) throw new SessionExpiredError();
  if (!can(staff.role, permission)) throw new CommerceError("FORBIDDEN", 403, "Your role does not allow this action.");
  return staff;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  return token;
}
