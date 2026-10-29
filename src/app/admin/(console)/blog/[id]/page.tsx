import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { Notice } from "@/app/admin/_components/ui";
import { EditorHost } from "@/app/admin/_components/editor/editor-host";
import { loadEditor } from "@/app/admin/_components/editor/load";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id === "new" ? "New post" : "Edit post" };
}

/** One route for new and existing posts, so the first save never swaps the editor out. */
export default async function POSTEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaffPage();
  if (!can(staff.role, "content.manage")) return <Notice tone="warning">Your account can&apos;t write posts. Ask the shop owner if you need this.</Notice>;
  const { id } = await params;
  return <EditorHost {...await loadEditor("POST", id === "new" ? null : id)} />;
}
