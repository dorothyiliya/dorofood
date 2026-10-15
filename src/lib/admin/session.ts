import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, SESSION_COOKIE, staffForToken, type Permission, type SessionStaff } from "@/lib/admin/auth";
import { CommerceError } from "@/lib/commerce/errors";

/** The signed-in staff member for this request, or null. */
export async function currentStaff(): Promise<SessionStaff | null> {
  const store = await cookies();
  return staffForToken(store.get(SESSION_COOKIE)?.value);
}

/** For pages: sends anonymous visitors to the login page. */
export async function requireStaffPage(): Promise<SessionStaff> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");
  return staff;
}

/** For server actions: every mutation re-checks the session and the permission. */
export async function requireStaff(permission: Permission): Promise<SessionStaff> {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");
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
