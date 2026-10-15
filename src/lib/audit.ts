import "server-only";
import type { Prisma } from "@prisma/client";

/** JSON columns cannot hold BigInt; store money as decimal strings. */
export function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {}, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export function recordAudit(
  tx: Prisma.TransactionClient,
  event: { action: string; entityType: string; entityId: string; actorId?: string | null; metadata?: unknown },
) {
  return tx.auditEvent.create({
    data: {
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      actorId: event.actorId ?? "system",
      metadata: event.metadata === undefined ? undefined : jsonSafe(event.metadata),
    },
  });
}

/** Row lock helper: serialises every state change on one order. */
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  return rows.length === 1;
}
