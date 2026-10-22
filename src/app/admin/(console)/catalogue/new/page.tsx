import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { getIntegration } from "@/lib/integrations/store";
import { Notice, PageHeader } from "@/app/admin/_components/ui";
import { NewProductForm } from "@/app/admin/_components/product-form";

export const metadata = { title: "Add a product" };

export default async function NewProductPage() {
  const staff = await requireStaffPage();
  const [categories, markets, ai, storage] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.market.findMany({ where: { status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true, code: true, name: true, currency: true, countryCode: true, status: true } }),
    getIntegration("nvidia"),
    getIntegration("storage"),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add a product" description="Fill in the five steps below and press Add product. You can change anything later."
        actions={<Link href="/admin/catalogue" className="text-sm text-slate-600 hover:underline">← All products</Link>} />
      {can(staff.role, "catalogue.manage")
        ? <NewProductForm categories={categories} markets={markets} aiReady={ai.active} uploads={storage.active} />
        : <Notice tone="warning">Your account can look at products but not add them. Ask the shop owner if you need this.</Notice>}
    </div>
  );
}
