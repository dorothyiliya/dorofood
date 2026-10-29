import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { postPath, postState } from "@/lib/blog/posts";
import { absoluteUrl } from "@/lib/seo/site";
import { Article } from "@/components/blog/article";

export const metadata = { title: "Preview" };

/** A draft or scheduled post exactly as it will look, visible only to signed-in staff. */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaffPage();
  if (!can(staff.role, "content.manage")) notFound();
  const { id } = await params;
  const post = await prisma.post.findUnique({ where: { id }, include: { author: { select: { name: true } }, categories: { select: { name: true, slug: true } }, tags: { select: { name: true, slug: true } } } });
  if (!post) notFound();
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="sticky top-0 z-30 bg-gold px-4 py-2 text-center text-sm font-medium text-gold-ink">
        Preview: {postState(post).toLowerCase()}. {postState(post) === "Published" ? "This is what readers see." : "Readers can't see this yet."} Close this tab to keep editing.
      </div>
      <Article post={post} url={absoluteUrl(postPath(post.type, post.slug))} />
    </div>
  );
}
