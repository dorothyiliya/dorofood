import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { can } from "@/lib/admin/auth";
import { SETTINGS, getSettings, type SettingKey } from "@/lib/settings";
import { siteOrigin } from "@/lib/seo/site";
import { applyTitlePattern } from "@/lib/seo/title";
import { scoreLabel } from "@/lib/seo/analysis";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, DateTime, Field, PageHeader, Select, Table, inputClass, td } from "@/app/admin/_components/ui";
import { deleteRedirectAction, saveRedirectAction, saveSeoSettingsAction } from "@/app/admin/actions/content";

export const metadata = { title: "SEO" };

const LONG = new Set<SettingKey>(["seo.defaultDescription", "seo.socialProfiles", "blog.description"]);
const GROUPS: { title: string; keys: SettingKey[] }[] = [
  { title: "How your site appears on Google", keys: ["seo.homeTitle", "seo.titleTemplate", "seo.defaultDescription", "seo.socialImage"] },
  { title: "Your blog", keys: ["blog.title", "blog.description"] },
  { title: "Connect to Google and Bing", keys: ["seo.googleVerification", "seo.bingVerification", "seo.socialProfiles"] },
  { title: "Visibility", keys: ["seo.hideFromSearch"] },
];

function Item({ ok, title, children }: { ok: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      {ok ? <CheckCircle size={22} weight="fill" className="shrink-0 text-brand-700" aria-hidden="true" /> : <WarningCircle size={22} weight="fill" className="shrink-0 text-amber-500" aria-hidden="true" />}
      <div className="text-sm"><div className="font-medium text-slate-900"><span className="sr-only">{ok ? "Done: " : "To do: "}</span>{title}</div><div className="mt-0.5 text-slate-600">{children}</div></div>
    </li>
  );
}

export default async function SeoPage() {
  const staff = await requireStaffPage();
  const editable = can(staff.role, "seo.manage");
  const origin = siteOrigin();
  const [settings, weak, noDescription, products, noPhoto, redirects] = await Promise.all([
    getSettings(),
    prisma.post.findMany({ where: { status: { not: "TRASHED" }, OR: [{ seoScore: { lt: 40 } }, { seoScore: null }] }, select: { id: true, title: true, type: true, seoScore: true }, orderBy: { updatedAt: "desc" }, take: 8 }),
    prisma.post.count({ where: { status: "PUBLISHED", seoDescription: null, excerpt: null } }),
    prisma.product.count({ where: { status: "ACTIVE" } }),
    prisma.product.count({ where: { status: "ACTIVE", media: { none: {} } } }),
    prisma.redirect.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="SEO" description="Help people find your shop on Google. Each post and page also has its own SEO tab in the editor." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Checklist">
          <ul className="-my-3 divide-y divide-slate-100">
            <Item ok={!settings["seo.hideFromSearch"]} title={settings["seo.hideFromSearch"] ? "Your site is hidden from search engines" : "Search engines can see your site"}>
              {settings["seo.hideFromSearch"] ? "Turn off “Hide the whole site” below when you're ready to be found." : "Google is allowed to list your shop and blog."}
            </Item>
            <Item ok={Boolean(settings["seo.googleVerification"])} title="Connect Google Search Console">
              {settings["seo.googleVerification"] ? "Connected. Check Search Console now and then to see what people search for." : (
                <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                  <li>Go to <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer" className="text-brand-800 underline">search.google.com/search-console</a> and add <strong>{origin}</strong> as a URL prefix.</li>
                  <li>Choose <strong>HTML tag</strong>, copy the code inside <code>content=&quot;…&quot;</code>, paste it below and save.</li>
                  <li>Press Verify in Search Console, then add the sitemap below.</li>
                </ol>
              )}
            </Item>
            <Item ok title="Your sitemap is ready">
              Google finds all your pages from <a href={`${origin}/sitemap.xml`} target="_blank" rel="noreferrer" className="break-all text-brand-800 underline">{origin}/sitemap.xml</a>. Submit this address in Search Console under Sitemaps. It updates itself.
            </Item>
            <Item ok={noDescription === 0} title={noDescription === 0 ? "Every published post has a description" : `${noDescription} published post${noDescription === 1 ? " has" : "s have"} no description`}>
              {noDescription === 0 ? "Google shows your own words under each title." : "Without one, Google picks text itself. Add one in the post's SEO tab."}
            </Item>
            <Item ok={noPhoto === 0} title={noPhoto === 0 ? "All products have photos" : `${noPhoto} of ${products} products have no photo`}>
              {noPhoto === 0 ? "Photos help products show up in Google Images." : <>Products with photos get more clicks. <Link href="/admin/catalogue" className="text-brand-800 underline">Go to products</Link></>}
            </Item>
          </ul>
        </Card>

        <Card title="Posts and pages that need SEO work" description="Lowest scores first. Open one and follow the SEO tab's checklist.">
          {weak.length === 0 ? <p className="text-sm text-slate-600">Nothing needs work. Well done.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {weak.map((p) => {
                const s = scoreLabel(p.seoScore);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/admin/${p.type === "PAGE" ? "pages" : "blog"}/${p.id}`} className="truncate text-brand-800 hover:underline">{p.title}</Link>
                    <span className="shrink-0 text-xs text-slate-600">{s.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Site settings" description={`Your home page on Google: “${settings["seo.homeTitle"]}”. Other pages: “${applyTitlePattern("Plantain Chips", settings["seo.titleTemplate"])}”.`}>
          <ActionForm action={saveSeoSettingsAction} submitLabel="Save settings">
            <fieldset disabled={!editable} className="space-y-8">
              {GROUPS.map((g) => (
                <div key={g.title}>
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">{g.title}</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {g.keys.map((key) => {
                      const def = SETTINGS[key];
                      const value = settings[key];
                      return (
                        <div key={key} className={LONG.has(key) ? "md:col-span-2" : ""}>
                          <input type="hidden" name={`present:${key}`} value="1" />
                          {typeof def.default === "boolean" ? (
                            <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                              <input type="checkbox" name={key} defaultChecked={value as boolean} className="mt-1" />
                              <span><span className="block font-medium text-slate-800">{def.label}</span><span className="text-xs text-slate-500">{def.help}</span></span>
                            </label>
                          ) : (
                            <Field label={def.label} help={def.help}>
                              {LONG.has(key)
                                ? <textarea name={key} rows={key === "seo.socialProfiles" ? 3 : 2} defaultValue={String(value)} className={inputClass} />
                                : <input name={key} defaultValue={String(value)} className={inputClass} />}
                            </Field>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </fieldset>
          </ActionForm>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Redirects" description="Send visitors (and Google) from an old address to a new one, e.g. after renaming a page. Posts you rename get one automatically.">
          {editable && (
            <ActionForm action={saveRedirectAction} submitLabel="Add redirect" inline className="mb-6">
              <Field label="Old address" className="min-w-[220px] flex-1"><input name="from" required placeholder="/old-recipe" className={inputClass} /></Field>
              <Field label="New address" className="min-w-[220px] flex-1"><input name="to" required placeholder="/blog/new-recipe" className={inputClass} /></Field>
              <Field label="Type"><Select name="kind" options={[["permanent", "Permanent (moved for good)"], ["temporary", "Temporary"]]} /></Field>
            </ActionForm>
          )}
          <Table head={["Old address", "Goes to", "Visits", "Last used", ""]} empty="No redirects yet.">
            {redirects.map((r) => (
              <tr key={r.id}>
                <td className={`${td} font-mono text-xs`}>{r.fromPath}</td>
                <td className={`${td} font-mono text-xs`}>{r.toPath}{!r.permanent && <span className="ml-2 font-sans text-slate-500">(temporary)</span>}{r.note && <div className="font-sans text-slate-500">{r.note}</div>}</td>
                <td className={`${td} tabular-nums`}>{r.hits}</td>
                <td className={`${td} text-sm`}><DateTime value={r.lastHitAt} /></td>
                <td className={`${td} text-right`}>{editable && <ActionForm action={deleteRedirectAction} hidden={{ redirectId: r.id }} submitLabel="Remove" variant="secondary" inline />}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
