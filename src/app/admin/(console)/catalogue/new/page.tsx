import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { Card, Notice, PageHeader } from "@/app/admin/_components/ui";
import { ProductForm } from "@/app/admin/_components/product-form";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const staff = await requireStaffPage();
  const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader title="New product" description="Create the product first; then add variants (SKUs), prices and stock." actions={<Link href="/admin/catalogue" className="text-sm text-slate-600 hover:underline">← Catalogue</Link>} />
      {can(staff.role, "catalogue.manage") ? <Card><ProductForm categories={categories} /></Card> : <Notice tone="warning">Your role cannot create products.</Notice>}
    </>
  );
}
