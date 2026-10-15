import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, Field, PageHeader, Select, StatusBadge, inputClass } from "@/app/admin/_components/ui";
import { saveCategoryAction } from "@/app/admin/actions/catalogue";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const staff = await requireStaffPage();
  const editable = can(staff.role, "catalogue.manage");
  const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } });

  return (
    <>
      <PageHeader title="Categories" description="Shop filters, in display order. Archive instead of deleting so past orders stay intact." />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title="Categories">
          <div className="divide-y divide-slate-100">
            {categories.length === 0 && <p className="text-sm text-slate-500">No categories yet.</p>}
            {categories.map((c) => (
              <div key={c.id} className="py-3">
                <div className="mb-2 flex items-center gap-2 text-sm"><span className="font-medium">{c.name}</span><StatusBadge status={c.status} /><span className="text-slate-500">{c._count.products} product(s)</span></div>
                {editable && (
                  <ActionForm action={saveCategoryAction} hidden={{ categoryId: c.id }} submitLabel="Save" variant="secondary" inline>
                    <CategoryFields category={c} />
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        </Card>
        {editable && (
          <Card title="New category">
            <ActionForm action={saveCategoryAction} submitLabel="Create category"><div className="grid gap-3"><CategoryFields /></div></ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

function CategoryFields({ category }: { category?: { name: string; slug: string; sortOrder: number; status: string } }) {
  return (
    <>
      <Field label="Name"><input name="name" required defaultValue={category?.name} className={inputClass} /></Field>
      <Field label="Slug"><input name="slug" required defaultValue={category?.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" className={inputClass} /></Field>
      <Field label="Order"><input name="sortOrder" required inputMode="numeric" defaultValue={category?.sortOrder ?? 0} className={`${inputClass} sm:!w-20`} /></Field>
      <Field label="Status"><Select name="status" options={["ACTIVE", "DRAFT", "ARCHIVED"]} defaultValue={category?.status ?? "ACTIVE"} /></Field>
    </>
  );
}
