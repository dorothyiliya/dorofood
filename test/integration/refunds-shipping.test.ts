import { describe, expect, it } from "vitest";
import { requestRefund } from "@/lib/commerce/refunds";
import { createShipmentForOrder, markShipmentDispatched, reviewExport, type CarrierAdapter } from "@/lib/commerce/shipments";
import { api, balance, checkoutBody, inventoryInvariantViolations, orderByNumber, prisma, seedFixture, setupIntegrationHarness } from "../support/harness";

const paystack = setupIntegrationHarness();

async function paidOrder(variantId: string, quantity = 1, destination: { market?: string; countryCode?: string } = {}) {
  const res = await api.checkout(checkoutBody([{ variantId, quantity }], destination));
  expect(res.status).toBe(201);
  paystack.pay(res.body.payment.reference);
  await api.webhook(paystack.chargeSuccessWebhook(res.body.payment.reference));
  const order = await orderByNumber(res.body.orderNumber);
  expect(order.status).toBe("CONFIRMED");
  return order;
}

function refundWebhook(event: string, refundId: number, reference: string, amount: number) {
  return paystack.webhook(event, { id: refundId, amount, currency: "NGN", status: event.split(".")[1], transaction_reference: reference });
}

describe("refunds", () => {
  it("full refund before dispatch releases stock; refund.processed completes it; replay is a no-op", async () => {
    const f = await seedFixture({ crispsStock: 3 });
    const order = await paidOrder(f.crisps, 2);
    const refund = await requestRefund({ orderId: order.id, reason: "Customer cancelled", actorId: "staff-1", idempotencyKey: "r-1" });

    expect(refund).toMatchObject({ status: "REFUND_PENDING", providerCallState: "SENT", amountMinor: BigInt(520000) });
    expect((await orderByNumber(order.orderNumber)).status).toBe("REFUND_PENDING");
    expect((await balance(f.crisps)).reservedQuantity).toBe(0);

    const delivery = refundWebhook("refund.processed", Number(refund.providerRef), order.payments[0].providerReference, 520000);
    expect((await api.webhook(delivery)).status).toBe(200);
    expect((await api.webhook(delivery)).body).toMatchObject({ duplicate: true });

    const after = await orderByNumber(order.orderNumber);
    expect(after.status).toBe("REFUNDED");
    expect(after.payments[0].status).toBe("REFUNDED");
    expect(await inventoryInvariantViolations()).toEqual([]);
  });

  it("partial refunds cannot exceed the amount paid, even when requested concurrently", async () => {
    const f = await seedFixture();
    const order = await paidOrder(f.crisps); // 335000
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, i) =>
      requestRefund({ orderId: order.id, amountMinor: BigInt(100000), reason: "Partial", actorId: "staff-1", idempotencyKey: `p-${i}` })));

    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(3);
    expect(attempts.filter((a) => a.status === "rejected").every((a) => (a as PromiseRejectedResult).reason.code === "REFUND_EXCEEDS_REMAINING")).toBe(true);
    expect(paystack.refunds.reduce((s, r) => s + r.amount, 0)).toBe(300000);
    // A partial refund does not cancel the order or release its stock.
    expect((await orderByNumber(order.orderNumber)).status).toBe("CONFIRMED");
  });

  it("the same refund request retried does not refund twice", async () => {
    const f = await seedFixture();
    const order = await paidOrder(f.crisps);
    await requestRefund({ orderId: order.id, amountMinor: BigInt(50000), reason: "Damaged", actorId: "staff-1", idempotencyKey: "same" });
    await requestRefund({ orderId: order.id, amountMinor: BigInt(50000), reason: "Damaged", actorId: "staff-1", idempotencyKey: "same" });
    expect(paystack.refunds).toHaveLength(1);
  });

  it("refund API outcome unknown: marked for manual reconciliation and never auto-retried", async () => {
    const f = await seedFixture();
    const order = await paidOrder(f.crisps);
    paystack.failNext("/refund", "lost-response");
    const refund = await requestRefund({ orderId: order.id, reason: "Cancelled", actorId: "staff-1", idempotencyKey: "u-1" });

    expect(refund.providerCallState).toBe("UNKNOWN");
    expect(paystack.refunds).toHaveLength(1); // it did happen at Paystack
    const job = await api.reconcile();
    expect(job.body.refunds).toMatchObject({ attempted: 0, needsManualReconciliation: 1 });
    expect(paystack.refunds).toHaveLength(1);

    // When Paystack's refund webhook arrives, it is matched by transaction + amount and completes the record.
    const r = paystack.refunds[0];
    await api.webhook(refundWebhook("refund.processed", r.id, r.transaction, r.amount));
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ status: "REFUNDED", providerRef: String(r.id) });
  });

  it("refund rejected by Paystack is recorded as FAILED and frees the amount for a corrected request", async () => {
    const f = await seedFixture();
    const order = await paidOrder(f.crisps);
    paystack.failNext("/refund", "reject");
    const refund = await requestRefund({ orderId: order.id, amountMinor: BigInt(1000), reason: "Test", actorId: "staff-1", idempotencyKey: "rej" });
    expect(refund).toMatchObject({ status: "FAILED", providerCallState: "REJECTED" });
    const full = await requestRefund({ orderId: order.id, reason: "Retry", actorId: "staff-1", idempotencyKey: "rej-2" });
    expect(full.amountMinor).toBe(BigInt(335000));
  });

  it("refund.failed webhook leaves the order flagged, not refunded", async () => {
    const f = await seedFixture();
    const order = await paidOrder(f.crisps);
    const refund = await requestRefund({ orderId: order.id, reason: "Cancelled", actorId: "staff-1", idempotencyKey: "f-1" });
    await api.webhook(refundWebhook("refund.failed", Number(refund.providerRef), order.payments[0].providerReference, 335000));
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ status: "FAILED" });
    expect((await orderByNumber(order.orderNumber)).status).toBe("REFUND_PENDING");
  });

  it("refuses to refund an unpaid order", async () => {
    const f = await seedFixture();
    const res = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]));
    const order = await orderByNumber(res.body.orderNumber);
    await expect(requestRefund({ orderId: order.id, reason: "x", actorId: "staff-1", idempotencyKey: "n" })).rejects.toMatchObject({ code: "NO_REFUNDABLE_PAYMENT" });
  });
});

describe("shipment creation", () => {
  it("carrier failure leaves the order paid, undispatched and retryable with the same idempotency key", async () => {
    const f = await seedFixture({ crispsStock: 2 });
    const order = await paidOrder(f.crisps);
    const keys: string[] = [];
    let fail = true;
    const flaky: CarrierAdapter = {
      code: "FLAKY",
      createShipment: async (req) => {
        keys.push(req.idempotencyKey);
        if (fail) throw new Error("Carrier API timeout");
        return { trackingNumber: "TRK-1" };
      },
    };

    await expect(createShipmentForOrder(order.id, flaky)).rejects.toMatchObject({ code: "SHIPMENT_CREATION_FAILED" });
    let current = await orderByNumber(order.orderNumber);
    expect(current.status).toBe("PROCESSING");
    expect(current.shipments[0]).toMatchObject({ status: "FAILED", attempts: 1, failureReason: "Carrier API timeout" });
    expect(await balance(f.crisps)).toMatchObject({ quantityOnHand: 2, reservedQuantity: 1 });
    await expect(markShipmentDispatched(current.shipments[0].id, "staff-1")).rejects.toMatchObject({ code: "SHIPMENT_NOT_READY" });

    fail = false;
    await createShipmentForOrder(order.id, flaky);
    current = await orderByNumber(order.orderNumber);
    expect(current.status).toBe("READY_TO_DISPATCH");
    expect(current.shipments).toHaveLength(1);
    expect(current.shipments[0]).toMatchObject({ status: "READY", attempts: 2, trackingNumber: "TRK-1" });
    expect(new Set(keys).size).toBe(1);
  });

  it("fails closed when no carrier is configured", async () => {
    const f = await seedFixture();
    const order = await paidOrder(f.crisps);
    await expect(createShipmentForOrder(order.id)).rejects.toMatchObject({ code: "SHIPPING_PROVIDER_NOT_CONFIGURED" });
    expect(await prisma.shipment.count()).toBe(0);
  });

  it("refuses to ship unpaid or refunded orders", async () => {
    const f = await seedFixture();
    const carrier: CarrierAdapter = { code: "OK", createShipment: async () => ({ trackingNumber: "T" }) };
    const unpaid = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]));
    await expect(createShipmentForOrder((await orderByNumber(unpaid.body.orderNumber)).id, carrier)).rejects.toMatchObject({ code: "ORDER_NOT_READY_FOR_SHIPMENT" });

    const paid = await paidOrder(f.crisps);
    await requestRefund({ orderId: paid.id, reason: "Cancelled", actorId: "staff-1", idempotencyKey: "c" });
    await expect(createShipmentForOrder(paid.id, carrier)).rejects.toMatchObject({ code: "ORDER_NOT_READY_FOR_SHIPMENT" });
  });
});

describe("international eligibility", () => {
  it("rejects a product that is not export-eligible for the destination, at quote and checkout", async () => {
    const f = await seedFixture();
    const quote = await api.quote({ market: "GB", countryCode: "GB", items: [{ variantId: f.crisps, quantity: 1 }] });
    expect(quote.status).toBe(422);
    expect(quote.body).toMatchObject({ code: "NOT_ELIGIBLE_FOR_DESTINATION", details: { variantIds: [f.crisps] } });
    const checkout = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }, { variantId: f.tea, quantity: 1 }], { market: "GB", countryCode: "GB" }));
    expect(checkout.body.code).toBe("NOT_ELIGIBLE_FOR_DESTINATION");
    expect(await prisma.order.count()).toBe(0);
    expect((await balance(f.crisps)).reservedQuantity).toBe(0);
  });

  it("rejects market/country mismatches and destinations without an enabled shipping rule", async () => {
    const f = await seedFixture();
    expect((await api.checkout(checkoutBody([{ variantId: f.tea, quantity: 1 }], { market: "GB", countryCode: "US" }))).body.code).toBe("DESTINATION_MARKET_MISMATCH");
    expect((await api.checkout(checkoutBody([{ variantId: f.tea, quantity: 1 }], { market: "US", countryCode: "US" }))).body.code).toBe("MARKET_UNAVAILABLE");
    await prisma.shippingRule.updateMany({ where: { countryCode: "GB" }, data: { enabled: false } });
    expect((await api.checkout(checkoutBody([{ variantId: f.tea, quantity: 1 }], { market: "GB", countryCode: "GB" }))).body.code).toBe("SHIPPING_UNAVAILABLE");
  });

  it("an eligible export order is held for export review before it can ship; rejection refunds", async () => {
    const f = await seedFixture();
    const carrier: CarrierAdapter = { code: "INTL", createShipment: async () => ({ trackingNumber: "INTL-1" }) };
    const order = await paidOrder(f.tea, 1, { market: "GB", countryCode: "GB" });
    expect(order).toMatchObject({ currency: "GBP", totalMinor: BigInt(2100), requiresExport: true });
    expect(order.exportRecord?.status).toBe("PENDING_REVIEW");

    await expect(createShipmentForOrder(order.id, carrier)).rejects.toMatchObject({ code: "EXPORT_NOT_APPROVED" });
    await reviewExport(order.id, "REJECTED", "compliance-1", "Destination restriction");
    const rejected = await orderByNumber(order.orderNumber);
    expect(rejected.status).toBe("REFUND_PENDING");
    expect(paystack.refunds).toEqual([expect.objectContaining({ amount: 2100 })]);
  });

  it("approved export orders ship", async () => {
    const f = await seedFixture();
    const carrier: CarrierAdapter = { code: "INTL", createShipment: async () => ({ trackingNumber: "INTL-2" }) };
    const order = await paidOrder(f.tea, 1, { market: "GB", countryCode: "GB" });
    await reviewExport(order.id, "APPROVED", "compliance-1");
    await createShipmentForOrder(order.id, carrier);
    expect((await orderByNumber(order.orderNumber)).status).toBe("READY_TO_DISPATCH");
  });
});

describe("fails safe when credentials are missing", () => {
  it("checkout, webhook and jobs refuse to run without configuration", async () => {
    const f = await seedFixture();
    const body = checkoutBody([{ variantId: f.crisps, quantity: 1 }]);

    process.env.CHECKOUT_ENABLED = "false";
    expect((await api.checkout(body)).body.code).toBe("CHECKOUT_DISABLED");
    process.env.CHECKOUT_ENABLED = "true";

    const secret = process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_SECRET_KEY;
    const noKey = await api.checkout(body);
    expect(noKey).toMatchObject({ status: 503, body: { code: "PAYMENTS_NOT_CONFIGURED" } });
    const hook = await api.webhook({ body: "{}", signature: "abc" });
    expect(hook.status).toBe(503); // Paystack retries until the key is configured

    process.env.PAYSTACK_SECRET_KEY = "sk_live_" + "x".repeat(40);
    expect((await api.checkout(body)).body.code).toBe("PAYMENTS_LIVE_KEY_BLOCKED");
    process.env.PAYSTACK_SECRET_KEY = secret;

    expect((await api.reconcile("Bearer wrong")).status).toBe(401);
    expect((await api.reconcile(null)).status).toBe(401);
    const cron = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect((await api.reconcile("Bearer ")).status).toBe(503);
    process.env.CRON_SECRET = cron;

    expect(await prisma.order.count()).toBe(0);
    expect((await balance(f.crisps)).reservedQuantity).toBe(0);
  });
});
