import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import type { Prisma, RecordStatus } from "@prisma/client";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { getSetting } from "@/lib/settings";
import { Card, Money, PageHeader, Pagination, StatusBadge, Table, inputClass, pageParam, stringParam, td } from "@/app/admin/_components/ui";

export const metadata = { title: "Products" };
const PAGE_SIZE = 50;
const SHOW_FILTER: [RecordStatus, string][] = [["ACTIVE", "In the shop"], ["DRAFT", "Hidden (drafts)"], ["ARCHIVED", "No longer sold"]];

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const staff = await requireStaffPage();
  const page = pageParam(params.page);
  const q = stringParam(params.q);
  const status = SHOW_FILTER.map(([s]) => s).find((s) => s === params.status);
  const location = await getSetting("fulfilment.locationCode");
  const where: Prisma.ProductWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { brand: { contains: q, mode: "insensitive" } }, { variants: { some: { sku: { contains: q.toUpperCase() } } } }] } : {}),
  };
  const products = await prisma.product.findMany({
    where, orderBy: { name: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
    include: {
      category: true,
      media: { orderBy: { sortOrder: "asc" }, take: 1 },
      variants: { orderBy: { createdAt: "asc" }, include: { marketProducts: { where: { status: "ACTIVE", market: { code: "NG" } } }, balances: { where: { location: { code: location } } } } },
    },
  });
  const addButton = can(staff.role, "catalogue.manage") && (
    <Link href="/admin/catalogue/new" className="inline-flex items-center gap-1.5 rounded-md bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900"><Plus size={16} weight="bold" aria-hidden="true" /> Add a product</Link>
  );

  return (
    <>
      <PageHeader title="Products" description="Everything you sell. Click a product to change its price, stock or photos." actions={addButton} />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
          <input name="q" defaultValue={q} placeholder="Search by name or brand" aria-label="Search products" className={`${inputClass} sm:!w-72`} />
          <select name="status" defaultValue={status ?? ""} aria-label="Show" className={`${inputClass} sm:!w-48`}>
            <option value="">All products</option>
            {SHOW_FILTER.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
          </select>
          <button className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white">Search</button>
        </form>
        <Table head={["", "Product", "Price in Nigeria", "In stock", "In the shop?"]} empty="No products yet. Press “Add a product” to add your first one. It takes about a minute.">
          {products.slice(0, PAGE_SIZE).map((p) => {
            const photo = p.media[0];
            return (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className={`${td} w-16`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- staff-supplied image URL */}
                  {photo ? <img src={photo.url} alt="" className="h-12 w-12 rounded-md bg-slate-100 object-cover" loading="lazy" /> : <div className="h-12 w-12 rounded-md bg-slate-100" aria-hidden="true" />}
                </td>
                <td className={td}>
                  <Link href={`/admin/catalogue/${p.id}`} className="font-medium text-brand-800 hover:underline">{p.name}</Link>
                  <div className="text-xs text-slate-500">{[p.category?.name, p.variants.map((v) => v.packSize).join(", ")].filter(Boolean).join(" · ")}</div>
                </td>
                <td className={`${td} text-sm`}>{p.variants.map((v) => <div key={v.id}>{v.marketProducts[0] ? <Money minor={v.marketProducts[0].priceMinor} currency={v.marketProducts[0].currency} /> : <span className="text-slate-400">No price</span>}</div>)}</td>
                <td className={`${td} tabular-nums`}>{p.variants.map((v) => <div key={v.id}>{v.balances[0] ? v.balances[0].quantityOnHand : 0}</div>)}</td>
                <td className={td}>{p.status === "ACTIVE" ? <StatusBadge status="Yes" tone="good" /> : <StatusBadge status={p.status === "DRAFT" ? "Hidden" : "No longer sold"} tone="neutral" />}</td>
              </tr>
            );
          })}
        </Table>
        <Pagination page={page} hasNext={products.length > PAGE_SIZE} href={(n) => `/admin/catalogue?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(n) })}`} />
      </Card>
    </>
  );
}
