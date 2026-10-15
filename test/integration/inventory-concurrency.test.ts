import { describe, expect, it } from "vitest";
import { api, balance, checkoutBody, idempotencyKey, inventoryInvariantViolations, prisma, seedFixture, setupIntegrationHarness } from "../support/harness";

setupIntegrationHarness();

describe("concurrent inventory reservations", () => {
  it("25 simultaneous checkouts for 5 units: exactly 5 orders, never oversold", async () => {
    const f = await seedFixture({ crispsStock: 5 });
    const results = await Promise.all(Array.from({ length: 25 }, () => api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]))));

    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(created).toHaveLength(5);
    expect(rejected).toHaveLength(20);
    expect(rejected.every((r) => r.body.code === "OUT_OF_STOCK")).toBe(true);
    expect(await balance(f.crisps)).toMatchObject({ quantityOnHand: 5, reservedQuantity: 5 });
    // A rejected checkout must leave nothing behind (the whole transaction rolls back).
    expect(await prisma.order.count()).toBe(5);
    expect(await inventoryInvariantViolations()).toEqual([]);
  });

  it("multi-item orders contending in opposite order neither deadlock nor oversell", async () => {
    const f = await seedFixture({ crispsStock: 6, teaStock: 6 });
    const a = checkoutBody([{ variantId: f.crisps, quantity: 2 }, { variantId: f.tea, quantity: 2 }]);
    const b = checkoutBody([{ variantId: f.tea, quantity: 2 }, { variantId: f.crisps, quantity: 2 }]);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => api.checkout(i % 2 ? a : b)));

    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.every((r) => r.status === 201 || r.body.code === "OUT_OF_STOCK")).toBe(true);
    expect((await balance(f.crisps)).reservedQuantity).toBe(6);
    expect((await balance(f.tea)).reservedQuantity).toBe(6);
    expect(await inventoryInvariantViolations()).toEqual([]);
  });

  it("the database itself rejects overselling even if application code is bypassed", async () => {
    const f = await seedFixture({ crispsStock: 2 });
    await expect(prisma.inventoryBalance.updateMany({ where: { variantId: f.crisps }, data: { reservedQuantity: 3 } })).rejects.toThrow(/InventoryBalance_reserved_within_onHand/);
    await expect(prisma.inventoryBalance.updateMany({ where: { variantId: f.crisps }, data: { quantityOnHand: -1, reservedQuantity: 0 } })).rejects.toThrow(/check constraint/i);
  });

  it("merges duplicate lines so per-line limits cannot be bypassed", async () => {
    const f = await seedFixture({ crispsStock: 100 });
    const res = await api.checkout(checkoutBody(Array.from({ length: 2 }, () => ({ variantId: f.crisps, quantity: 30 }))));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("QUANTITY_LIMIT");
  });
});

describe("idempotent checkout (lost response between customer and server)", () => {
  it("a retried request with the same key returns the same order, not a second reservation", async () => {
    const f = await seedFixture({ crispsStock: 5 });
    const key = idempotencyKey();
    const body = checkoutBody([{ variantId: f.crisps, quantity: 2 }]);
    const first = await api.checkout(body, key);
    const retry = await api.checkout(body, key);

    expect(retry.status).toBe(201);
    expect(retry.body.orderNumber).toBe(first.body.orderNumber);
    expect(retry.body.payment.reference).toBe(first.body.payment.reference);
    expect(await prisma.order.count()).toBe(1);
    expect((await balance(f.crisps)).reservedQuantity).toBe(2);
  });

  it("simultaneous duplicate submissions create one order", async () => {
    const f = await seedFixture({ crispsStock: 5 });
    const key = idempotencyKey();
    const body = checkoutBody([{ variantId: f.crisps, quantity: 1 }]);
    const results = await Promise.all(Array.from({ length: 6 }, () => api.checkout(body, key)));

    expect(await prisma.order.count()).toBe(1);
    expect((await balance(f.crisps)).reservedQuantity).toBe(1);
    const numbers = new Set(results.filter((r) => r.status === 201).map((r) => r.body.orderNumber));
    expect(numbers.size).toBe(1);
    // Losers either got the same order or were told initialisation is in flight; none created a second Paystack transaction.
    expect(results.every((r) => r.status === 201 || r.body.code === "PAYMENT_INITIALISATION_IN_PROGRESS")).toBe(true);
    expect(await prisma.paymentTransaction.count()).toBe(1);
  });

  it("reusing a key for a different basket is rejected", async () => {
    const f = await seedFixture();
    const key = idempotencyKey();
    await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]), key);
    const reused = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 3 }]), key);
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("requires an idempotency key", async () => {
    const f = await seedFixture();
    const res = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]), null);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});
