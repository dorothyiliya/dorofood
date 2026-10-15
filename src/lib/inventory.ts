import "server-only";
import type { InventoryReservationStatus, Prisma } from "@prisma/client";

/**
 * Inventory lifecycle (one balance row per variant and location):
 *
 *   reserve  -> ACTIVE     reserved += q            (checkout, payment pending)
 *   commit   ACTIVE -> COMMITTED   no balance change  (payment verified; stock stays allocated)
 *   release  ACTIVE|COMMITTED -> RELEASED|EXPIRED   reserved -= q
 *   fulfil   COMMITTED -> FULFILLED  on hand -= q, reserved -= q  (dispatch)
 *
 * Every transition is a conditional UPDATE on the reservation's current status,
 * so concurrent callers (payment webhook vs expiry job) cannot both win. Database
 * CHECK constraints keep 0 <= reserved <= on hand regardless of application bugs.
 * All functions must run inside the caller's transaction.
 */

export class InsufficientStockError extends Error {
  constructor(public readonly variantId: string) {
    super("INSUFFICIENT_STOCK");
    this.name = "InsufficientStockError";
  }
}

export async function reserveInventory(
  tx: Prisma.TransactionClient,
  input: { variantId: string; locationId: string; quantity: number; orderId: string; expiresAt: Date; status?: "ACTIVE" | "COMMITTED" },
) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error("Quantity must be a positive integer.");
  }

  // Only one of several concurrent requests can take the final units: the row
  // lock taken by UPDATE makes later requests re-evaluate the WHERE clause.
  const updated = await tx.$executeRaw`
    UPDATE "InventoryBalance"
    SET "reservedQuantity" = "reservedQuantity" + ${input.quantity},
        "updatedAt" = NOW()
    WHERE "variantId" = ${input.variantId}
      AND "locationId" = ${input.locationId}
      AND "quantityOnHand" - "reservedQuantity" >= ${input.quantity}
  `;
  if (updated !== 1) throw new InsufficientStockError(input.variantId);

  return tx.inventoryReservation.create({
    data: {
      variantId: input.variantId,
      locationId: input.locationId,
      orderId: input.orderId,
      quantity: input.quantity,
      status: input.status ?? "ACTIVE",
      expiresAt: input.expiresAt,
    },
  });
}

async function transition(
  tx: Prisma.TransactionClient,
  reservationId: string,
  from: InventoryReservationStatus[],
  to: InventoryReservationStatus,
) {
  const { count } = await tx.inventoryReservation.updateMany({
    where: { id: reservationId, status: { in: from } },
    data: { status: to },
  });
  return count === 1;
}

/** ACTIVE -> COMMITTED. Returns false if the reservation already expired or was released. */
export function commitReservation(tx: Prisma.TransactionClient, reservationId: string) {
  return transition(tx, reservationId, ["ACTIVE"], "COMMITTED");
}

/** Returns stock to the sellable pool. Returns false if another caller already moved it. */
export async function releaseReservation(
  tx: Prisma.TransactionClient,
  reservation: { id: string; variantId: string; locationId: string; quantity: number },
  options: { from: Array<"ACTIVE" | "COMMITTED">; to: "RELEASED" | "EXPIRED" },
) {
  if (!(await transition(tx, reservation.id, options.from, options.to))) return false;
  await tx.$executeRaw`
    UPDATE "InventoryBalance"
    SET "reservedQuantity" = "reservedQuantity" - ${reservation.quantity}, "updatedAt" = NOW()
    WHERE "variantId" = ${reservation.variantId} AND "locationId" = ${reservation.locationId}
  `;
  return true;
}

/** COMMITTED -> FULFILLED: the goods physically leave the location. */
export async function fulfilReservation(
  tx: Prisma.TransactionClient,
  reservation: { id: string; variantId: string; locationId: string; quantity: number },
  audit: { reference: string; actorId: string | null },
) {
  if (!(await transition(tx, reservation.id, ["COMMITTED"], "FULFILLED"))) return false;
  await tx.$executeRaw`
    UPDATE "InventoryBalance"
    SET "quantityOnHand" = "quantityOnHand" - ${reservation.quantity},
        "reservedQuantity" = "reservedQuantity" - ${reservation.quantity},
        "updatedAt" = NOW()
    WHERE "variantId" = ${reservation.variantId} AND "locationId" = ${reservation.locationId}
  `;
  await tx.inventoryMovement.create({
    data: {
      variantId: reservation.variantId,
      locationId: reservation.locationId,
      quantityDelta: -reservation.quantity,
      reason: "DISPATCH",
      reference: audit.reference,
      actorId: audit.actorId,
    },
  });
  return true;
}
