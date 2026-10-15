import { describe, expect, it } from "vitest";
import { expireStaleOrders } from "@/lib/commerce/jobs";
import { api, balance, checkoutBody, expirePaymentWindow, idempotencyKey, inventoryInvariantViolations, orderByNumber, prisma, seedFixture, setupIntegrationHarness } from "../support/harness";

const paystack = setupIntegrationHarness();

async function startCheckout(variantId: string, quantity = 1) {
  const res = await api.checkout(checkoutBody([{ variantId, quantity }]));
  expect(res.status).toBe(201);
  return { orderNumber: res.body.orderNumber as string, reference: res.body.payment.reference as string };
}

describe("webhook authentication and replay", () => {
  it("rejects unsigned, forged and wrong-key signatures without touching state", async () => {
    const f = await seedFixture();
    const { orderNumber, reference } = await startCheckout(f.crisps);
    paystack.pay(reference);
    const genuine = paystack.chargeSuccessWebhook(reference);

    expect((await api.webhook({ body: genuine.body, signature: null })).status).toBe(401);
    expect((await api.webhook({ body: genuine.body, signature: "0".repeat(128) })).status).toBe(401);
    expect((await api.webhook(paystack.webhook("charge.success", { reference }, "sk_test_attacker"))).status).toBe(401);
    expect((await api.webhook({ body: genuine.body.replace(/}$/, ', "x": 1}'), signature: genuine.signature })).status).toBe(401);
    expect(await prisma.paymentEvent.count()).toBe(0);
    expect((await orderByNumber(orderNumber)).status).toBe("PENDING_PAYMENT");
  });

  it("a signed charge.success for an unpaid transaction does not confirm (amounts come from the Verify API)", async () => {
    const f = await seedFixture();
    const { orderNumber, reference } = await startCheckout(f.crisps);
    // Forged-but-signed content (e.g. a leaked key) claiming success; Paystack itself says "abandoned".
    const res = await api.webhook(paystack.webhook("charge.success", { reference, amount: 335000, currency: "NGN", status: "success" }));
    expect(res.status).toBe(200);
    expect((await orderByNumber(orderNumber)).status).toBe("PENDING_PAYMENT");
  });

  it("duplicate and replayed notifications confirm exactly once", async () => {
    const f = await seedFixture({ crispsStock: 3 });
    const { orderNumber, reference } = await startCheckout(f.crisps, 2);
    paystack.pay(reference);
    const delivery = paystack.chargeSuccessWebhook(reference);

    const concurrent = await Promise.all(Array.from({ length: 8 }, () => api.webhook(delivery)));
    expect(concurrent.every((r) => r.status === 200)).toBe(true);
    const replay = await api.webhook(delivery);
    expect(replay.body).toMatchObject({ duplicate: true });

    const order = await orderByNumber(orderNumber);
    expect(order.status).toBe("CONFIRMED");
    expect(order.reservations.map((r) => r.status)).toEqual(["COMMITTED"]);
    expect(await prisma.paymentEvent.count()).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "PAYMENT_CONFIRMED" } })).toBe(1);
    expect(await prisma.refund.count()).toBe(0);
    expect(paystack.refunds).toHaveLength(0);
    expect(await balance(f.crisps)).toMatchObject({ quantityOnHand: 3, reservedQuantity: 2 });
    expect(await inventoryInvariantViolations()).toEqual([]);
  });

  it("a webhook arriving while Paystack Verify is down is stored, answered non-2xx, and recovered by reconciliation", async () => {
    const f = await seedFixture();
    const { orderNumber, reference } = await startCheckout(f.crisps);
    paystack.pay(reference);
    paystack.failNext("/transaction/verify/", "server-error");

    const first = await api.webhook(paystack.chargeSuccessWebhook(reference));
    expect(first.status).toBe(500); // Paystack will redeliver
    expect(await prisma.paymentEvent.findFirst()).toMatchObject({ status: "FAILED", attempts: 1 });
    expect((await orderByNumber(orderNumber)).status).toBe("PENDING_PAYMENT");

    await prisma.paymentEvent.updateMany({ data: { receivedAt: new Date(Date.now() - 5 * 60_000) } });
    const job = await api.reconcile();
    expect(job.status).toBe(200);
    expect(job.body.events).toMatchObject({ examined: 1, processed: 1 });
    expect((await orderByNumber(orderNumber)).status).toBe("CONFIRMED");
  });
});

describe("payment succeeded but a response was lost", () => {
  it("webhook never arrives: the customer's return page verifies and confirms", async () => {
    const f = await seedFixture();
    const { orderNumber, reference } = await startCheckout(f.crisps);
    paystack.pay(reference);

    const res = await api.verify(reference);
    expect(res.body).toMatchObject({ orderNumber, orderStatus: "CONFIRMED", paymentStatus: "SUCCEEDED" });
  });

  it("webhook never arrives and customer never returns: reconciliation job confirms", async () => {
    const f = await seedFixture();
    const { orderNumber, reference } = await startCheckout(f.crisps);
    paystack.pay(reference);
    await prisma.paymentTransaction.updateMany({ data: { createdAt: new Date(Date.now() - 20 * 60_000) } });

    const job = await api.reconcile();
    expect(job.body.payments.outcomes).toMatchObject({ CONFIRMED: 1 });
    expect((await orderByNumber(orderNumber)).status).toBe("CONFIRMED");
  });

  it("Paystack created the transaction but our initialize response was lost: retry starts a fresh attempt, no duplicate order", async () => {
    const f = await seedFixture({ crispsStock: 2 });
    const key = idempotencyKey();
    const body = checkoutBody([{ variantId: f.crisps, quantity: 1 }]);
    paystack.failNext("/transaction/initialize", "lost-response");

    const first = await api.checkout(body, key);
    expect(first.status).toBe(502);
    expect(first.body.code).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
    expect(paystack.transactions.size).toBe(1); // it did reach Paystack

    await prisma.paymentTransaction.updateMany({ data: { createdAt: new Date(Date.now() - 60_000) } }); // lease expired
    const retry = await api.checkout(body, key);
    expect(retry.status).toBe(201);
    expect(await prisma.order.count()).toBe(1);
    expect((await balance(f.crisps)).reservedQuantity).toBe(1);
    expect(await prisma.paymentTransaction.count()).toBe(2);
    expect(paystack.transactions.size).toBe(2);
  });

  it("the customer is charged on two attempts for one order: the second charge is refunded automatically", async () => {
    const f = await seedFixture({ crispsStock: 2 });
    const key = idempotencyKey();
    const body = checkoutBody([{ variantId: f.crisps, quantity: 1 }]);
    paystack.failNext("/transaction/initialize", "lost-response");
    await api.checkout(body, key);
    await prisma.paymentTransaction.updateMany({ data: { createdAt: new Date(Date.now() - 60_000) } });
    const retry = await api.checkout(body, key);

    const [lostRef] = [...paystack.transactions.keys()].filter((r) => r !== retry.body.payment.reference);
    paystack.pay(retry.body.payment.reference);
    paystack.pay(lostRef);
    await api.webhook(paystack.chargeSuccessWebhook(retry.body.payment.reference));
    await api.webhook(paystack.chargeSuccessWebhook(lostRef));

    const order = await orderByNumber(retry.body.orderNumber);
    expect(order.status).toBe("CONFIRMED");
    const duplicate = order.payments.find((p) => p.providerReference === lostRef)!;
    expect(duplicate.refunds).toHaveLength(1);
    expect(duplicate.refunds[0]).toMatchObject({ reason: "DUPLICATE_PAYMENT", providerCallState: "SENT" });
    expect(paystack.refunds).toEqual([expect.objectContaining({ transaction: lostRef, amount: 335000 })]);
    expect((await balance(f.crisps)).reservedQuantity).toBe(1);
  });

  it("an underpayment is never confirmed: order goes to manual review", async () => {
    const f = await seedFixture();
    const { orderNumber, reference } = await startCheckout(f.crisps);
    paystack.pay(reference, { amount: 100 });
    await api.webhook(paystack.chargeSuccessWebhook(reference));
    const order = await orderByNumber(orderNumber);
    expect(order.status).toBe("PAYMENT_REVIEW");
    expect(order.payments[0].failureReason).toMatch(/AMOUNT_MISMATCH/);
  });

  it("a payment in the wrong currency is never confirmed", async () => {
    const f = await seedFixture();
    const { orderNumber, reference } = await startCheckout(f.crisps);
    paystack.pay(reference, { currency: "USD" });
    await api.verify(reference);
    expect((await orderByNumber(orderNumber)).status).toBe("PAYMENT_REVIEW");
  });

  it("a declined charge leaves the order open for retry and its stock held", async () => {
    const f = await seedFixture();
    const { orderNumber, reference } = await startCheckout(f.crisps);
    paystack.decline(reference);
    const res = await api.verify(reference);
    expect(res.body).toMatchObject({ orderNumber, orderStatus: "PENDING_PAYMENT", paymentStatus: "FAILED" });
    expect((await balance(f.crisps)).reservedQuantity).toBe(1);
  });
});

describe("payment window expiry and late payment", () => {
  it("an unpaid order expires and its stock returns to sale", async () => {
    const f = await seedFixture({ crispsStock: 1 });
    const { orderNumber } = await startCheckout(f.crisps);
    await expirePaymentWindow(orderNumber);

    expect(await expireStaleOrders()).toMatchObject({ expired: 1 });
    const order = await orderByNumber(orderNumber);
    expect(order.status).toBe("CANCELLED");
    expect(order.reservations[0].status).toBe("EXPIRED");
    expect((await balance(f.crisps)).reservedQuantity).toBe(0);
    expect((await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]))).status).toBe(201);
  });

  it("paid at the last second, before the expiry job ran: confirmed, not cancelled", async () => {
    const f = await seedFixture({ crispsStock: 1 });
    const { orderNumber, reference } = await startCheckout(f.crisps);
    paystack.pay(reference);
    await expirePaymentWindow(orderNumber);

    expect(await expireStaleOrders()).toMatchObject({ confirmed: 1, expired: 0 });
    expect((await orderByNumber(orderNumber)).status).toBe("CONFIRMED");
  });

  it("late payment after expiry, stock still available: re-reserved and confirmed", async () => {
    const f = await seedFixture({ crispsStock: 3 });
    const { orderNumber, reference } = await startCheckout(f.crisps, 2);
    await expirePaymentWindow(orderNumber);
    await expireStaleOrders();
    expect((await balance(f.crisps)).reservedQuantity).toBe(0);

    paystack.pay(reference);
    await api.webhook(paystack.chargeSuccessWebhook(reference));

    const order = await orderByNumber(orderNumber);
    expect(order.status).toBe("CONFIRMED");
    expect(order.cancelledAt).toBeNull();
    expect((await balance(f.crisps)).reservedQuantity).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: "LATE_PAYMENT_CONFIRMED" } })).toBe(1);
    expect(await inventoryInvariantViolations()).toEqual([]);
  });

  it("late payment after expiry, stock sold to someone else: refunded in full, not confirmed", async () => {
    const f = await seedFixture({ crispsStock: 1 });
    const { orderNumber, reference } = await startCheckout(f.crisps);
    await expirePaymentWindow(orderNumber);
    await expireStaleOrders();
    const other = await startCheckout(f.crisps); // takes the last unit
    expect(other.orderNumber).not.toBe(orderNumber);

    paystack.pay(reference);
    await api.webhook(paystack.chargeSuccessWebhook(reference));

    const order = await orderByNumber(orderNumber);
    expect(order.status).toBe("REFUND_PENDING");
    expect(order.payments[0].refunds[0]).toMatchObject({ reason: "STOCK_UNAVAILABLE_AFTER_PAYMENT", amountMinor: BigInt(335000), providerCallState: "SENT" });
    expect(paystack.refunds).toHaveLength(1);
    expect(await balance(f.crisps)).toMatchObject({ quantityOnHand: 1, reservedQuantity: 1 }); // still held for the other customer
    expect(await inventoryInvariantViolations()).toEqual([]);
  });

  it("expiry job and payment webhook racing: one consistent outcome, stock never double-counted", async () => {
    for (let round = 0; round < 5; round++) {
      const f = await seedFixture({ crispsStock: 1 });
      const { orderNumber, reference } = await startCheckout(f.crisps);
      paystack.pay(reference);
      await expirePaymentWindow(orderNumber);
      // Make the expiry job's own pre-check miss the payment so the two paths truly race.
      paystack.failNext("/transaction/verify/", "network");

      await Promise.all([expireStaleOrders({ now: new Date(Date.now() + 60 * 60_000) }), api.webhook(paystack.chargeSuccessWebhook(reference))]);

      const order = await orderByNumber(orderNumber);
      expect(["CONFIRMED", "REFUND_PENDING"]).toContain(order.status);
      expect(await inventoryInvariantViolations()).toEqual([]);
      const b = await balance(f.crisps);
      expect(b.reservedQuantity).toBe(order.status === "CONFIRMED" ? 1 : 0);
      await (await import("../support/harness")).resetDatabase();
      paystack.reset();
    }
  });
});
