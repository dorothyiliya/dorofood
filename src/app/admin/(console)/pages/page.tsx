import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { PostList } from "@/app/admin/_components/post-list";

export const metadata = { title: "Pages" };

export default async function PagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaffPage();
  return <PostList type="PAGE" params={await searchParams} editable={can(staff.role, "content.manage")} />;
}
