import Link from "next/link";
import type { Prisma, RecordStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { getSetting } from "@/lib/settings";
import { Card, Money, PageHeader, Pagination, StatusBadge, Table, humanise, inputClass, pageParam, stringParam, td } from "@/app/admin/_components/ui";

export const metadata = { title: "Catalogue" };
const PAGE_SIZE = 50;

export default async function CataloguePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const staff = await requireStaffPage();
  const page = pageParam(params.page);
  const q = stringParam(params.q);
  const status = (["DRAFT", "ACTIVE", "ARCHIVED"] as RecordStatus[]).find((s) => s === params.status);
  const location = await getSetting("fulfilment.locationCode");
  const where: Prisma.ProductWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q } }, { variants: { some: { sku: { contains: q.toUpperCase() } } } }] } : {}),
  };
  const products = await prisma.product.findMany({
    where, orderBy: { name: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
    include: {
      category: true,
      variants: { include: { marketProducts: { include: { market: true } }, balances: { where: { location: { code: location } } } } },
    },
  });

  return (
    <>
      <PageHeader title="Catalogue" description="Products, their variants and prices per market."
        actions={can(staff.role, "catalogue.manage") && <Link href="/admin/catalogue/new" className="rounded-md bg-brand-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-900">New product</Link>} />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
          <input name="q" defaultValue={q} placeholder="Name, slug or SKU" aria-label="Search products" className={`${inputClass} sm:!w-72`} />
          <select name="status" defaultValue={status ?? ""} aria-label="Status" className={`${inputClass} sm:!w-40`}>
            <option value="">All statuses</option>
            {["DRAFT", "ACTIVE", "ARCHIVED"].map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
          </select>
          <button className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white">Filter</button>
        </form>
        <Table head={["Product", "Category", "Status", "Variants", "Prices", `Sellable (${location})`]} empty="No products yet. Create one to start selling.">
          {products.slice(0, PAGE_SIZE).map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className={td}><Link href={`/admin/catalogue/${p.id}`} className="font-medium text-brand-800 hover:underline">{p.name}</Link><div className="text-xs text-slate-500">{p.brand ?? ""} · /{p.slug}</div></td>
              <td className={td}>{p.category?.name ?? "-"}</td>
              <td className={td}><StatusBadge status={p.status} /></td>
              <td className={`${td} text-xs`}>{p.variants.map((v) => <div key={v.id} className="font-mono">{v.sku} <span className="font-sans text-slate-500">{v.packSize}</span></div>)}</td>
              <td className={`${td} text-xs`}>{p.variants.flatMap((v) => v.marketProducts.map((mp) => <div key={mp.id}>{mp.market.code}: <Money minor={mp.priceMinor} currency={mp.currency} />{mp.status !== "ACTIVE" && <span className="text-slate-500"> ({mp.status.toLowerCase()})</span>}</div>))}</td>
              <td className={`${td} tabular-nums`}>{p.variants.map((v) => <div key={v.id}>{v.balances[0] ? v.balances[0].quantityOnHand - v.balances[0].reservedQuantity : 0}</div>)}</td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} hasNext={products.length > PAGE_SIZE} href={(n) => `/admin/catalogue?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(n) })}`} />
      </Card>
    </>
  );
}
