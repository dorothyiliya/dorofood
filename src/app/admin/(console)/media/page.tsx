import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { listMedia } from "@/lib/content/media";
import { getIntegration } from "@/lib/integrations/store";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, Notice, PageHeader, Pagination, inputClass, pageParam, stringParam } from "@/app/admin/_components/ui";
import { MediaUploader } from "@/app/admin/_components/media-uploader";
import { deleteMediaAction, updateMediaAltAction } from "@/app/admin/actions/content";

export const metadata = { title: "Picture library" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const staff = await requireStaffPage();
  const editable = can(staff.role, "content.manage");
  const page = pageParam(params.page);
  const q = stringParam(params.q);
  const [{ items, hasNext }, storage] = await Promise.all([listMedia({ page, q, pageSize: 36 }), getIntegration("storage")]);
  return (
    <>
      <PageHeader title="Picture library" description="Every picture uploaded for the blog and pages. Reuse them from the editor's Picture button." />
      {editable && (storage.active
        ? <div className="mb-6"><MediaUploader /></div>
        : <div className="mb-6"><Notice tone="warning">Uploads aren&apos;t switched on yet (Connected services → Photo storage).</Notice></div>)}
      <Card>
        <form className="mb-4 flex gap-2" role="search">
          <input name="q" defaultValue={q} placeholder="Search by name or description" aria-label="Search pictures" className={`${inputClass} sm:!w-72`} />
          <button className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white">Search</button>
        </form>
        {items.length === 0 ? <p className="text-sm text-slate-500">No pictures yet.</p> : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {items.map((m) => (
              <li key={m.id} className="rounded-lg border border-slate-200 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded picture */}
                <img src={m.url} alt={m.altText} loading="lazy" className="aspect-square w-full rounded-md bg-slate-100 object-cover" />
                <p className="mt-1 truncate text-xs text-slate-500" title={m.fileName}>{m.fileName} · {Math.round(m.sizeBytes / 1024)} KB</p>
                {editable && (
                  <div className="mt-2 space-y-2">
                    <ActionForm action={updateMediaAltAction} hidden={{ mediaId: m.id }} submitLabel="Save" variant="secondary">
                      <input name="altText" defaultValue={m.altText} placeholder="Describe the picture" aria-label="Picture description" className={`${inputClass} text-xs`} />
                    </ActionForm>
                    <ActionForm action={deleteMediaAction} hidden={{ mediaId: m.id }} submitLabel="Delete" variant="secondary" confirm="Delete this picture? Posts using it will show a gap." />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} hasNext={hasNext} href={(n) => `/admin/media?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`} />
      </Card>
    </>
  );
}
