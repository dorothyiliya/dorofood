import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { StaffRole, StaffUser } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

/* ---------------------------------------------------------------- passwords */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const MIN_PASSWORD_LENGTH = 12;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "Password is too long.";
  if (new Set(password).size < 6) return "Password is too repetitive.";
  return null;
}

/* -------------------------------------------------------------- permissions */

export const PERMISSIONS = [
  "view",
  "orders.manage",      // cancel unpaid orders, resolve payment reviews, verify payments
  "orders.fulfil",      // shipments, dispatch, delivery, export review
  "refunds.manage",     // issue and reconcile refunds
  "payments.manage",    // reprocess webhook events
  "catalogue.manage",   // products, variants, categories, prices
  "inventory.manage",   // stock receipts, adjustments, locations
  "markets.manage",     // markets and shipping rules
  "settings.manage",    // store settings
  "staff.manage",       // staff accounts
  "jobs.run",           // run reconciliation now
  "content.manage",     // blog posts, pages, media library, blog categories and tags
  "seo.manage",         // search engine settings and redirects
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);
export const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<Permission>> = {
  OWNER: ALL,
  ADMIN: ALL,
  FINANCE: new Set(["view", "orders.manage", "refunds.manage", "payments.manage", "jobs.run"]),
  FULFILMENT: new Set(["view", "orders.fulfil", "inventory.manage"]),
  CATALOGUE: new Set(["view", "catalogue.manage", "inventory.manage", "content.manage"]),
  EDITOR: new Set(["view", "content.manage", "seo.manage"]),
  VIEWER: new Set(["view"]),
};

export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  OWNER: "Everything, including managing other owners.",
  ADMIN: "Everything except managing owners.",
  FINANCE: "Payments, refunds, payment reviews, reconciliation.",
  FULFILMENT: "Shipping, dispatch, export review, stock.",
  CATALOGUE: "Products, prices, categories, stock, blog and pages.",
  EDITOR: "Writes blog posts and pages, and looks after SEO.",
  VIEWER: "Read-only access to everything.",
};

export function can(role: StaffRole, permission: Permission) {
  return ROLE_PERMISSIONS[role].has(permission);
}

/* ----------------------------------------------------------------- sessions */

export const SESSION_COOKIE = "dfa_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// Verifying against a real hash for unknown emails keeps response time uniform.
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export type SessionStaff = Pick<StaffUser, "id" | "email" | "name" | "role">;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export type LoginResult = { ok: true; token: string; expiresAt: Date } | { ok: false; error: string };

export async function login(email: string, password: string, userAgent: string | null): Promise<LoginResult> {
  const generic: LoginResult = { ok: false, error: "Email or password is incorrect." };
  const user = await prisma.staffUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    return generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: "Too many failed attempts. Try again in a few minutes." };
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid || !user.active) {
    if (valid && !user.active) return generic;
    const failed = user.failedLoginCount + 1;
    await prisma.$transaction(async (tx) => {
      await tx.staffUser.update({
        where: { id: user.id },
        data: failed >= MAX_FAILED_LOGINS ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : { failedLoginCount: failed },
      });
      if (failed >= MAX_FAILED_LOGINS) await recordAudit(tx, { action: "STAFF_LOCKED_OUT", entityType: "StaffUser", entityId: user.id });
    });
    return generic;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.$transaction(async (tx) => {
    await tx.staffUser.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await tx.staffSession.create({ data: { tokenHash: hashToken(token), staffUserId: user.id, expiresAt, userAgent: userAgent?.slice(0, 300) } });
    await tx.staffSession.deleteMany({ where: { staffUserId: user.id, expiresAt: { lt: new Date() } } });
    await recordAudit(tx, { action: "STAFF_LOGIN", entityType: "StaffUser", entityId: user.id, actorId: user.id });
  });
  return { ok: true, token, expiresAt };
}

export async function staffForToken(token: string | undefined | null): Promise<SessionStaff | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.staffSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { staffUser: true } });
  if (!session || session.expiresAt <= new Date() || !session.staffUser.active) return null;
  // Sessions issued before a password change are no longer valid.
  if (session.createdAt < session.staffUser.passwordChangedAt) return null;
  const { id, email, name, role } = session.staffUser;
  return { id, email, name, role };
}

export async function logout(token: string | undefined | null) {
  if (token) await prisma.staffSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function revokeSessions(staffUserId: string) {
  await prisma.staffSession.deleteMany({ where: { staffUserId } });
}
