import { prisma } from "@/lib/prisma";
import { requireStaffPage } from "@/lib/admin/session";
import { MIN_PASSWORD_LENGTH, ROLE_DESCRIPTIONS, can } from "@/lib/admin/auth";
import { ActionForm } from "@/app/admin/_components/action-form";
import { Card, DateTime, Field, PageHeader, Select, StatusBadge, humanise, inputClass } from "@/app/admin/_components/ui";
import { changeOwnPasswordAction, createStaffAction, resetPasswordAction, updateStaffAction } from "@/app/admin/actions/config";

export const metadata = { title: "Staff" };
const ROLES = ["OWNER", "ADMIN", "FINANCE", "FULFILMENT", "CATALOGUE", "VIEWER"] as const;

export default async function StaffPage() {
  const staff = await requireStaffPage();
  const manage = can(staff.role, "staff.manage");
  const users = await prisma.staffUser.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  const roleOptions = ROLES.filter((r) => staff.role === "OWNER" || r !== "OWNER");

  return (
    <>
      <PageHeader title="Staff" description="Who can sign in to this control centre, and what each person may do." />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title="Accounts">
          <div className="divide-y divide-slate-100">
            {users.map((u) => {
              const touchable = manage && (staff.role === "OWNER" || u.role !== "OWNER");
              return (
                <div key={u.id} className="py-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{u.name}</span><span className="text-slate-500">{u.email}</span>
                    <StatusBadge status={u.role} tone="neutral" />
                    {!u.active && <StatusBadge status="Deactivated" tone="critical" />}
                    {u.lockedUntil && u.lockedUntil > new Date() && <StatusBadge status="Locked" tone="warning" />}
                    {u.id === staff.id && <span className="text-xs text-brand-800">(you)</span>}
                    <span className="text-xs text-slate-500">Last sign-in: <DateTime value={u.lastLoginAt} /></span>
                  </div>
                  {touchable && u.id !== staff.id && (
                    <div className="grid gap-3 lg:grid-cols-2">
                      <ActionForm action={updateStaffAction} hidden={{ staffId: u.id }} submitLabel="Save" variant="secondary" inline>
                        <Field label="Name"><input name="name" required defaultValue={u.name} className={inputClass} /></Field>
                        <Field label="Role"><Select name="role" options={roleOptions} defaultValue={u.role} /></Field>
                        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> Active</label>
                      </ActionForm>
                      <ActionForm action={resetPasswordAction} hidden={{ staffId: u.id }} submitLabel="Set password" variant="secondary" inline>
                        <Field label="New password"><input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} /></Field>
                      </ActionForm>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-6">
          {manage && (
            <Card title="Add staff member">
              <ActionForm action={createStaffAction} submitLabel="Create account">
                <Field label="Name"><input name="name" required className={inputClass} /></Field>
                <Field label="Email"><input name="email" type="email" required className={inputClass} /></Field>
                <Field label="Role"><Select name="role" options={roleOptions} defaultValue="VIEWER" /></Field>
                <Field label="Initial password" help={`At least ${MIN_PASSWORD_LENGTH} characters. Share it privately.`}><input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} /></Field>
              </ActionForm>
            </Card>
          )}
          <Card title="Change your password" description="You will be signed out everywhere and asked to sign in again.">
            <ActionForm action={changeOwnPasswordAction} submitLabel="Change password">
              <Field label="Current password"><input name="current" type="password" required autoComplete="current-password" className={inputClass} /></Field>
              <Field label="New password"><input name="next" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} /></Field>
            </ActionForm>
          </Card>
          <Card title="Roles">
            <dl className="space-y-2 text-sm">
              {ROLES.map((r) => <div key={r}><dt className="font-medium">{humanise(r)}</dt><dd className="text-slate-600">{ROLE_DESCRIPTIONS[r]}</dd></div>)}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
