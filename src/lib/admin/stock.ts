import "server-only";
import { z } from "zod";
import type { StockMovementReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { CommerceError, isUniqueViolation } from "@/lib/commerce/errors";

export const ADJUSTMENT_REASONS = ["RECEIPT", "DAMAGE", "WRITE_OFF", "CORRECTION", "RECALL", "SALE_RETURN", "STOCKTAKE"] as const satisfies readonly StockMovementReason[];

export const stockChangeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("delta"), quantity: z.number().int().min(-1_000_000).max(1_000_000).refine((q) => q !== 0, "Quantity cannot be zero."), reason: z.enum(ADJUSTMENT_REASONS).exclude(["STOCKTAKE"]) }),
  z.object({ mode: z.literal("count"), quantity: z.number().int().min(0).max(1_000_000), reason: z.literal("STOCKTAKE") }),
]);

/**
 * Changes physical stock on hand. Never lets on-hand drop below what is already
 * reserved for customers (the database CHECK constraint backs this up), and
 * records an InventoryMovement for every change.
 */
export async function changeStock(
  input: { variantId: string; locationId: string; note: string } & z.input<typeof stockChangeSchema>,
  actorId: string,
) {
  const change = stockChangeSchema.parse(input);
  if (change.reason === "RECEIPT" && change.quantity < 0) throw new CommerceError("INVALID_RECEIPT", 422, "A receipt must add stock.");
  return prisma.$transaction(async (tx) => {
    await tx.inventoryBalance.upsert({
      where: { variantId_locationId: { variantId: input.variantId, locationId: input.locationId } },
      create: { variantId: input.variantId, locationId: input.locationId },
      update: {},
    });
    const [balance] = await tx.$queryRaw<{ quantityOnHand: number; reservedQuantity: number }[]>`
      SELECT "quantityOnHand", "reservedQuantity" FROM "InventoryBalance"
      WHERE "variantId" = ${input.variantId} AND "locationId" = ${input.locationId} FOR UPDATE`;
    const delta = change.mode === "count" ? change.quantity - balance.quantityOnHand : change.quantity;
    const next = balance.quantityOnHand + delta;
    if (next < balance.reservedQuantity) {
      throw new CommerceError("BELOW_RESERVED", 409, `On hand cannot go below the ${balance.reservedQuantity} unit(s) already reserved for customers.`);
    }
    if (delta === 0) return { onHand: next, reserved: balance.reservedQuantity, delta };
    await tx.$executeRaw`
      UPDATE "InventoryBalance" SET "quantityOnHand" = ${next}, "updatedAt" = NOW()
      WHERE "variantId" = ${input.variantId} AND "locationId" = ${input.locationId}`;
    await tx.inventoryMovement.create({
      data: { variantId: input.variantId, locationId: input.locationId, quantityDelta: delta, reason: change.reason, note: input.note || null, actorId, reference: "admin" },
    });
    await recordAudit(tx, { action: "STOCK_CHANGED", entityType: "ProductVariant", entityId: input.variantId, actorId, metadata: { locationId: input.locationId, delta, reason: change.reason, onHand: next } });
    return { onHand: next, reserved: balance.reservedQuantity, delta };
  });
}

export const locationSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/),
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(500),
  active: z.boolean(),
});

export async function saveLocation(id: string | null, input: z.input<typeof locationSchema>, actorId: string) {
  const data = locationSchema.parse(input);
  const record = { code: data.code, name: data.name, active: data.active, addressJson: { text: data.address } };
  try {
    return await prisma.$transaction(async (tx) => {
      const location = id ? await tx.inventoryLocation.update({ where: { id }, data: record }) : await tx.inventoryLocation.create({ data: record });
      await recordAudit(tx, { action: id ? "LOCATION_UPDATED" : "LOCATION_CREATED", entityType: "InventoryLocation", entityId: location.id, actorId, metadata: data });
      return location;
    });
  } catch (error) {
    if (isUniqueViolation(error, "code")) throw new CommerceError("DUPLICATE", 409, "Another location already uses this code.");
    throw error;
  }
}
