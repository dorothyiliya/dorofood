import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { Notice } from "@/app/admin/_components/ui";
import { EditorHost } from "@/app/admin/_components/editor/editor-host";
import { loadEditor } from "@/app/admin/_components/editor/load";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: (await params).id === "new" ? "New page" : "Edit page" };
}

/** One route for new and existing pages, so the first save never swaps the editor out. */
export default async function PAGEEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaffPage();
  if (!can(staff.role, "content.manage")) return <Notice tone="warning">Your account can&apos;t write pages. Ask the shop owner if you need this.</Notice>;
  const { id } = await params;
  return <EditorHost {...await loadEditor("PAGE", id === "new" ? null : id)} />;
}
