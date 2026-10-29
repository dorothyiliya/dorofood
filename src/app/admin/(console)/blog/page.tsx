import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { PostList } from "@/app/admin/_components/post-list";

export const metadata = { title: "Blog posts" };

export default async function BlogPostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaffPage();
  return (
    <>
      <PostList type="POST" params={await searchParams} editable={can(staff.role, "content.manage")} />
      <p className="mt-4 text-sm text-slate-500"><Link href="/admin/blog/categories" className="text-brand-800 hover:underline">Manage blog categories and tags →</Link></p>
    </>
  );
}
