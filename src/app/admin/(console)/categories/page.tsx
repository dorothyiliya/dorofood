import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, Field, MoreOptions, PageHeader, Select, StatusBadge, inputClass } from "@/app/admin/_components/ui";
import { saveCategoryAction } from "@/app/admin/actions/catalogue";

export const metadata = { title: "Categories" };

const SHOW: [string, string][] = [["ACTIVE", "Show in the shop"], ["DRAFT", "Hidden for now"], ["ARCHIVED", "No longer used"]];

export default async function CategoriesPage() {
  const staff = await requireStaffPage();
  const editable = can(staff.role, "catalogue.manage");
  const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } });

  return (
    <>
      <PageHeader title="Categories" description="Groups customers use to browse the shop, like Snacks or Drinks. Each product can be in one category." />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title="Your categories">
          <div className="divide-y divide-slate-100">
            {categories.length === 0 && <p className="text-sm text-slate-500">No categories yet. Add one on the right, e.g. Snacks.</p>}
            {categories.map((c) => (
              <div key={c.id} className="py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{c.name}</span>
                  {c.status === "ACTIVE" ? <StatusBadge status="In the shop" tone="good" /> : <StatusBadge status={c.status === "DRAFT" ? "Hidden" : "No longer used"} tone="neutral" />}
                  <span className="text-slate-500">{c._count.products} product{c._count.products === 1 ? "" : "s"}</span>
                </div>
                {editable && (
                  <ActionForm action={saveCategoryAction} hidden={{ categoryId: c.id }} submitLabel="Save" variant="secondary">
                    <CategoryFields category={c} />
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        </Card>
        {editable && (
          <Card title="Add a category">
            <ActionForm action={saveCategoryAction} submitLabel="Add category"><CategoryFields /></ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

function CategoryFields({ category }: { category?: { name: string; slug: string; sortOrder: number; status: string } }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input name="name" required defaultValue={category?.name} placeholder="e.g. Snacks" className={inputClass} /></Field>
        <Field label="Show in the shop?"><Select name="status" options={SHOW} defaultValue={category?.status ?? "ACTIVE"} /></Field>
      </div>
      <MoreOptions>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Position" help="Lower numbers appear first in the shop."><input name="sortOrder" inputMode="numeric" defaultValue={category?.sortOrder ?? 0} className={inputClass} /></Field>
          <Field label="Web address" help="Made from the name if left empty."><input name="slug" defaultValue={category?.slug ?? ""} pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Lowercase letters, numbers and single dashes" className={inputClass} /></Field>
        </div>
      </MoreOptions>
    </div>
  );
}
