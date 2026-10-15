import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { ConfigError } from "@/lib/env";
import { CommerceError } from "@/lib/commerce/errors";
import { ProviderRejectedError, ProviderUnavailableError } from "@/lib/payments/paystack";
import { requireStaff } from "@/lib/admin/session";
import type { Permission, SessionStaff } from "@/lib/admin/auth";

export type ActionState = { ok: boolean; message: string; at: number } | null;

/**
 * Wraps every admin mutation: re-authenticates, checks the permission, and turns
 * expected failures into a message for the form. Unexpected errors are logged
 * and shown generically so internals never reach the browser.
 */
export async function adminAction(
  permission: Permission,
  fn: (staff: SessionStaff) => Promise<string>,
  options: { storefront?: boolean } = {},
): Promise<ActionState> {
  try {
    const staff = await requireStaff(permission);
    const message = await fn(staff);
    revalidatePath("/admin", "layout");
    if (options.storefront) revalidatePath("/");
    return { ok: true, message, at: Date.now() };
  } catch (error) {
    unstable_rethrow(error);
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
  if (error instanceof ProviderUnavailableError) return "Paystack could not be reached. Nothing was changed; try again shortly.";
  if (error instanceof ProviderRejectedError) return `Paystack rejected the request: ${error.message}`;
  console.error("[admin] action failed", error);
  return "Something went wrong. Nothing was changed.";
}
