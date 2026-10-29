import "server-only";
import { z } from "zod";
import type { StaffRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { CommerceError, isUniqueViolation } from "@/lib/commerce/errors";
import { hashPassword, passwordProblem, revokeSessions, verifyPassword, type SessionStaff } from "@/lib/admin/auth";

const role = z.enum(["OWNER", "ADMIN", "FINANCE", "FULFILMENT", "CATALOGUE", "EDITOR", "VIEWER"]);

export const newStaffSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  name: z.string().trim().min(2).max(80),
  role,
  password: z.string(),
});

export const staffUpdateSchema = z.object({ name: z.string().trim().min(2).max(80), role, active: z.boolean() });

function assertPassword(password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new CommerceError("WEAK_PASSWORD", 422, problem);
}

/** Only owners may create, edit or promote owners. */
type Actor = Pick<SessionStaff, "id" | "role">;

function assertCanTouch(actor: Actor, targetRole: StaffRole, newRole?: StaffRole) {
  if ((targetRole === "OWNER" || newRole === "OWNER") && actor.role !== "OWNER") {
    throw new CommerceError("FORBIDDEN", 403, "Only an owner can manage owner accounts.");
  }
}

export async function createStaff(input: z.input<typeof newStaffSchema>, actor: Actor) {
  const data = newStaffSchema.parse(input);
  assertCanTouch(actor, data.role, data.role);
  assertPassword(data.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.staffUser.create({ data: { email: data.email, name: data.name, role: data.role, passwordHash: await hashPassword(data.password) } });
      await recordAudit(tx, { action: "STAFF_CREATED", entityType: "StaffUser", entityId: user.id, actorId: actor.id, metadata: { email: data.email, role: data.role } });
      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error, "email")) throw new CommerceError("DUPLICATE", 409, "A staff account with this email already exists.");
    throw error;
  }
}

export async function updateStaff(id: string, input: z.input<typeof staffUpdateSchema>, actor: SessionStaff) {
  const data = staffUpdateSchema.parse(input);
  await prisma.$transaction(async (tx) => {
    // Serialise staff changes so two owners cannot demote each other at the same time.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('staff-admin'))::text`;
    const target = await tx.staffUser.findUnique({ where: { id } });
    if (!target) throw new CommerceError("STAFF_NOT_FOUND", 404, "Staff member not found.");
    assertCanTouch(actor, target.role, data.role);
    if (id === actor.id && (!data.active || data.role !== target.role)) {
      throw new CommerceError("SELF_CHANGE", 409, "You cannot change your own role or deactivate yourself.");
    }
    if (target.role === "OWNER" && (data.role !== "OWNER" || !data.active)) {
      const owners = await tx.staffUser.count({ where: { role: "OWNER", active: true, id: { not: id } } });
      if (owners === 0) throw new CommerceError("LAST_OWNER", 409, "There must always be at least one active owner.");
    }
    await tx.staffUser.update({ where: { id }, data });
    if (!data.active || data.role !== target.role) await tx.staffSession.deleteMany({ where: { staffUserId: id } });
    await recordAudit(tx, { action: "STAFF_UPDATED", entityType: "StaffUser", entityId: id, actorId: actor.id, metadata: { from: { role: target.role, active: target.active }, to: { role: data.role, active: data.active } } });
  });
}

export async function resetStaffPassword(id: string, password: string, actor: SessionStaff) {
  assertPassword(password);
  const target = await prisma.staffUser.findUnique({ where: { id } });
  if (!target) throw new CommerceError("STAFF_NOT_FOUND", 404, "Staff member not found.");
  assertCanTouch(actor, target.role);
  await prisma.$transaction(async (tx) => {
    await tx.staffUser.update({ where: { id }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    await recordAudit(tx, { action: "STAFF_PASSWORD_RESET", entityType: "StaffUser", entityId: id, actorId: actor.id });
  });
  await revokeSessions(id);
}

/** Changing your own password signs out every other session (and this one; the caller signs back in). */
export async function changeOwnPassword(actor: SessionStaff, current: string, next: string) {
  assertPassword(next);
  const user = await prisma.staffUser.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(current, user.passwordHash))) throw new CommerceError("WRONG_PASSWORD", 422, "Your current password is incorrect.");
  await prisma.$transaction(async (tx) => {
    await tx.staffUser.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
    await recordAudit(tx, { action: "STAFF_PASSWORD_CHANGED", entityType: "StaffUser", entityId: actor.id, actorId: actor.id });
  });
  await revokeSessions(actor.id);
}
