import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

/**
 * Refreshes the public blog after the editor saves. It is a separate request on
 * purpose: revalidating inside the save action would also refresh the admin
 * page and could interrupt someone who is still typing.
 */
export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff || !can(staff.role, "content.manage")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const path = typeof body?.path === "string" && /^\/[a-z0-9/-]{0,200}$/.test(body.path) ? body.path : null;
  revalidatePath("/blog", "layout");
  revalidatePath("/", "layout");
  revalidatePath("/sitemap.xml");
  if (path) revalidatePath(path);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
