import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, Field, MoreOptions, PageHeader, inputClass } from "@/app/admin/_components/ui";
import { deleteBlogCategoryAction, deleteBlogTagAction, saveBlogCategoryAction } from "@/app/admin/actions/content";

export const metadata = { title: "Blog categories and tags" };

export default async function BlogCategoriesPage() {
  const staff = await requireStaffPage();
  const editable = can(staff.role, "content.manage");
  const [categories, tags] = await Promise.all([
    prisma.blogCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { posts: true } } } }),
    prisma.blogTag.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { posts: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Blog categories and tags" description="Categories are the main sections of your blog, like Recipes or News. Tags are smaller labels, like rice or party food."
        actions={<Link href="/admin/blog" className="text-sm text-slate-600 hover:underline">← Blog posts</Link>} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title="Categories">
          {categories.length === 0 && <p className="text-sm text-slate-500">No categories yet. Add one on the right.</p>}
          <div className="divide-y divide-slate-100">
            {categories.map((c) => (
              <div key={c.id} className="py-3">
                <div className="mb-2 text-sm"><span className="font-medium">{c.name}</span> <span className="text-slate-500">· {c._count.posts} post{c._count.posts === 1 ? "" : "s"} · /blog/category/{c.slug}</span></div>
                {editable && (
                  <div className="space-y-2">
                    <ActionForm action={saveBlogCategoryAction} hidden={{ categoryId: c.id }} submitLabel="Save" variant="secondary">
                      <CategoryFields category={c} />
                    </ActionForm>
                    <ActionForm action={deleteBlogCategoryAction} hidden={{ categoryId: c.id }} submitLabel="Delete category" variant="secondary" confirm={`Delete "${c.name}"? Its posts are kept.`} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-6">
          {editable && (
            <Card title="Add a category">
              <ActionForm action={saveBlogCategoryAction} submitLabel="Add category"><CategoryFields /></ActionForm>
            </Card>
          )}
          <Card title="Tags" description="Tags are created as you write. Delete ones you no longer use.">
            {tags.length === 0 ? <p className="text-sm text-slate-500">No tags yet.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {tags.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <span>{t.name} <span className="text-slate-500">({t._count.posts})</span></span>
                    {editable && <ActionForm action={deleteBlogTagAction} hidden={{ tagId: t.id }} submitLabel="Delete" variant="secondary" inline />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function CategoryFields({ category }: { category?: { name: string; slug: string; description: string | null } }) {
  return (
    <div className="space-y-3">
      <Field label="Name"><input name="name" required defaultValue={category?.name} placeholder="e.g. Recipes" className={inputClass} /></Field>
      <Field label="Description (optional)" help="Shown at the top of the category page and on Google."><textarea name="description" rows={2} defaultValue={category?.description ?? ""} className={inputClass} /></Field>
      <MoreOptions>
        <Field label="Web address" help="Made from the name if left empty."><input name="slug" defaultValue={category?.slug ?? ""} className={inputClass} /></Field>
      </MoreOptions>
    </div>
  );
}
