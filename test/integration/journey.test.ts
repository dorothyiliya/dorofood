import { describe, expect, it } from "vitest";
import { createShipmentForOrder, markShipmentDispatched, type CarrierAdapter } from "@/lib/commerce/shipments";
import { api, balance, checkoutBody, inventoryInvariantViolations, orderByNumber, prisma, seedFixture, setupIntegrationHarness } from "../support/harness";

const paystack = setupIntegrationHarness();

const okCarrier: CarrierAdapter = {
  code: "FAKE",
  createShipment: async (req) => ({ trackingNumber: `TRK-${req.orderNumber}`, trackingUrl: null }),
};

describe("critical journey: discovery -> verified payment -> fulfilment (mocked Paystack + carrier)", () => {
  it("sells real stock exactly once and records every step", async () => {
    const f = await seedFixture({ crispsStock: 5 });

    // Discovery: authoritative catalogue from the database.
    const products = await api.products("?market=NG&q=crisps");
    expect(products.status).toBe(200);
    const crisps = products.body.data.find((p: { variantId: string }) => p.variantId === f.crisps);
    expect(crisps).toMatchObject({ priceMinor: "185000", currency: "NGN", available: true });

    // Quote uses the same pricing rules and reserves nothing.
    const quote = await api.quote({ market: "NG", countryCode: "NG", items: [{ variantId: f.crisps, quantity: 2 }] });
    expect(quote.body).toMatchObject({ subtotalMinor: "370000", shippingMinor: "150000", totalMinor: "520000" });
    expect((await balance(f.crisps)).reservedQuantity).toBe(0);

    // Checkout: order + reservation + Paystack session. Client-sent prices are impossible.
    const checkout = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 2 }]));
    expect(checkout.status).toBe(201);
    expect(checkout.body).toMatchObject({ status: "PENDING_PAYMENT", totalMinor: "520000", currency: "NGN" });
    const { reference, authorizationUrl } = checkout.body.payment;
    expect(authorizationUrl).toMatch(/^https:\/\/checkout\.paystack\.test\//);
    expect(paystack.transactions.get(reference)).toMatchObject({ amount: 520000, currency: "NGN" });
    expect((await balance(f.crisps)).reservedQuantity).toBe(2);

    // Browser redirect before payment completes: not confirmed.
    expect((await api.verify(reference)).body).toMatchObject({ orderStatus: "PENDING_PAYMENT" });

    // Customer pays; Paystack sends a signed webhook; app verifies server-to-server.
    paystack.pay(reference);
    const hook = await api.webhook(paystack.chargeSuccessWebhook(reference));
    expect(hook.status).toBe(200);
    expect(paystack.calls.some((c) => c.path === `/transaction/verify/${reference}`)).toBe(true);

    let order = await orderByNumber(checkout.body.orderNumber);
    expect(order.status).toBe("CONFIRMED");
    expect(order.payments[0]).toMatchObject({ status: "SUCCEEDED", amountMinor: BigInt(520000) });
    expect(order.reservations.map((r) => r.status)).toEqual(["COMMITTED"]);

    // Fulfilment: carrier consignment, then dispatch moves stock out.
    await createShipmentForOrder(order.id, okCarrier);
    order = await orderByNumber(checkout.body.orderNumber);
    expect(order.status).toBe("READY_TO_DISPATCH");
    await markShipmentDispatched(order.shipments[0].id, "staff-1");

    order = await orderByNumber(checkout.body.orderNumber);
    expect(order.status).toBe("DISPATCHED");
    expect(order.reservations[0].status).toBe("FULFILLED");
    expect(await balance(f.crisps)).toMatchObject({ quantityOnHand: 3, reservedQuantity: 0 });
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { variantId: f.crisps } });
    expect(movement).toMatchObject({ quantityDelta: -2, reason: "DISPATCH", reference: order.orderNumber });

    const actions = (await prisma.auditEvent.findMany({ where: { entityId: order.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["ORDER_CREATED", "PAYMENT_CONFIRMED", "SHIPMENT_CREATED", "ORDER_DISPATCHED"]);
    expect(await inventoryInvariantViolations()).toEqual([]);
  });
});
