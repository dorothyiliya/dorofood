import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { ConfigError } from "@/lib/env";
import { CommerceError } from "@/lib/commerce/errors";
import { ProviderRejectedError, ProviderUnavailableError } from "@/lib/payments/types";
import { requireStaff, SessionExpiredError } from "@/lib/admin/session";
import type { Permission, SessionStaff } from "@/lib/admin/auth";

/**
 * `redirectTo` is an internal "/admin/..." path the form navigates to in the
 * browser. Server-side redirects from actions are avoided on purpose: Next.js
 * renders an action's redirect target internally, bypassing the middleware that
 * maps the admin host's clean paths, so the browser must do the navigation.
 */
export type ActionState = { ok: boolean; message: string; at: number; redirectTo?: string } | null;
export type ActionResult = string | { message: string; redirectTo?: string; ok?: boolean };

/**
 * Wraps every admin mutation: re-authenticates, checks the permission, and turns
 * expected failures into a message for the form. Unexpected errors are logged
 * and shown generically so internals never reach the browser.
 */
export async function adminAction(
  permission: Permission,
  fn: (staff: SessionStaff) => Promise<ActionResult>,
  options: { storefront?: boolean; revalidate?: boolean } = {},
): Promise<ActionState> {
  try {
    const staff = await requireStaff(permission);
    const result = await fn(staff);
    if (options.revalidate !== false) revalidatePath("/admin", "layout");
    if (options.storefront) revalidatePath("/");
    return typeof result === "string" ? { ok: true, message: result, at: Date.now() } : { ok: true, ...result, at: Date.now() };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof SessionExpiredError) return { ok: false, message: "Your session has ended. Please sign in again.", at: Date.now(), redirectTo: "/admin/login" };
    return { ok: false, message: describe(error), at: Date.now() };
  }
}

function describe(error: unknown): string {
  if (error instanceof CommerceError) return error.message;
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue.path.filter((p) => typeof p === "string").join(".");
    return field ? `${field}: ${issue.message}` : issue.message;
  }
  if (error instanceof RangeError) return error.message;
  if (error instanceof ConfigError) return `Not configured: ${error.message}`;
  if (error instanceof ProviderUnavailableError) {
    console.warn("[admin] provider unavailable", error.message); // no secrets in these messages; makes outages diagnosable
    return "The provider could not be reached. Nothing was changed; try again shortly.";
  }
  if (error instanceof ProviderRejectedError) return `The provider rejected the request: ${error.message}`;
  console.error("[admin] action failed", error);
  return "Something went wrong. Nothing was changed.";
}
