import { describe, expect, it } from "vitest";
import { can, login, logout, staffForToken } from "@/lib/admin/auth";
import { createStaff, resetStaffPassword, updateStaff, changeOwnPassword } from "@/lib/admin/staff";
import { getSettings, updateSettings } from "@/lib/settings";
import { changeStock } from "@/lib/admin/stock";
import { saveCategory, saveMarketPrice, saveProduct, saveVariant } from "@/lib/admin/catalogue";
import { saveMarket, saveShippingRule } from "@/lib/admin/markets";
import { cancelUnpaidOrder, createManualShipment, dispatchShipment, markShipmentDelivered, reprocessPaymentEvent, resolvePaymentReview, resolveRefundManually } from "@/lib/admin/operations";
import { runReconciliationJob } from "@/lib/admin/system";
import { requestRefund } from "@/lib/commerce/refunds";
import { api, balance, checkoutBody, inventoryInvariantViolations, orderByNumber, prisma, seedFixture, setupIntegrationHarness } from "../support/harness";

const paystack = setupIntegrationHarness();
const PASSWORD = "correct horse battery staple";

async function owner() {
  return createStaff({ email: "owner@example.com", name: "Owner", role: "OWNER", password: PASSWORD }, { id: "bootstrap", role: "OWNER" });
}

async function paidOrder(variantId: string, quantity = 1) {
  const res = await api.checkout(checkoutBody([{ variantId, quantity }]));
  paystack.pay(res.body.payment.reference);
  await api.webhook(paystack.chargeSuccessWebhook(res.body.payment.reference));
  return orderByNumber(res.body.orderNumber);
}

describe("staff authentication", () => {
  it("logs in, resolves the session, and logs out", async () => {
    const user = await owner();
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
    const result = await login("OWNER@example.com ", PASSWORD, "vitest");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await staffForToken(result.token)).toMatchObject({ email: "owner@example.com", role: "OWNER" });
    // Only a hash of the token is stored.
    expect(await prisma.staffSession.count({ where: { tokenHash: result.token } })).toBe(0);
    await logout(result.token);
    expect(await staffForToken(result.token)).toBeNull();
  });

  it("gives the same answer for unknown emails and wrong passwords, and locks after 5 failures", async () => {
    await owner();
    const unknown = await login("nobody@example.com", PASSWORD, null);
    const wrong = await login("owner@example.com", "wrong password!!", null);
    expect(unknown).toEqual(wrong);
    for (let i = 0; i < 4; i++) await login("owner@example.com", "wrong password!!", null);
    const locked = await login("owner@example.com", PASSWORD, null);
    expect(locked).toMatchObject({ ok: false, error: expect.stringMatching(/Too many failed attempts/) });
    expect(await prisma.auditEvent.count({ where: { action: "STAFF_LOCKED_OUT" } })).toBe(1);
  });

  it("rejects expired sessions, deactivated staff, and sessions from before a password change", async () => {
    const user = await owner();
    const second = await createStaff({ email: "ops@example.com", name: "Ops", role: "FULFILMENT", password: PASSWORD }, user);
    const a = await login("ops@example.com", PASSWORD, null);
    if (!a.ok) throw new Error("login failed");
    await prisma.staffSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await staffForToken(a.token)).toBeNull();

    const b = await login("ops@example.com", PASSWORD, null);
    if (!b.ok) throw new Error("login failed");
    await resetStaffPassword(second.id, "a brand new passphrase", user);
    expect(await staffForToken(b.token)).toBeNull();
    expect((await login("ops@example.com", PASSWORD, null)).ok).toBe(false);

    await updateStaff(second.id, { name: "Ops", role: "FULFILMENT", active: false }, user);
    expect((await login("ops@example.com", "a brand new passphrase", null)).ok).toBe(false);
  });

  it("changing your own password requires the current one and ends other sessions", async () => {
    const user = await owner();
    const s = await login("owner@example.com", PASSWORD, null);
    if (!s.ok) throw new Error("login failed");
    await expect(changeOwnPassword(user, "not my password", "another long passphrase")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await changeOwnPassword(user, PASSWORD, "another long passphrase");
    expect(await staffForToken(s.token)).toBeNull();
  });

  it("rejects weak passwords", async () => {
    await expect(owner().then((o) => createStaff({ email: "x@example.com", name: "Xavier", role: "VIEWER", password: "short" }, o))).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(createStaff({ email: "y@example.com", name: "Yemi", role: "VIEWER", password: "aaaaaaaaaaaaaaaa" }, { id: "b", role: "OWNER" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });
});

describe("roles and staff safety rules", () => {
  it("permission matrix", () => {
    expect(can("VIEWER", "view")).toBe(true);
    expect(can("VIEWER", "refunds.manage")).toBe(false);
    expect(can("FINANCE", "refunds.manage")).toBe(true);
    expect(can("FINANCE", "catalogue.manage")).toBe(false);
    expect(can("FULFILMENT", "orders.fulfil")).toBe(true);
    expect(can("FULFILMENT", "settings.manage")).toBe(false);
    expect(can("CATALOGUE", "catalogue.manage")).toBe(true);
    expect(can("CATALOGUE", "refunds.manage")).toBe(false);
    expect(can("ADMIN", "staff.manage")).toBe(true);
  });

  it("admins cannot create or promote owners; the last owner cannot be removed; nobody can demote themselves", async () => {
    const o = await owner();
    const admin = await createStaff({ email: "admin@example.com", name: "Admin", role: "ADMIN", password: PASSWORD }, o);
    const adminActor = { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
    await expect(createStaff({ email: "o2@example.com", name: "O2", role: "OWNER", password: PASSWORD }, adminActor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateStaff(admin.id, { name: "Admin", role: "OWNER", active: true }, adminActor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateStaff(o.id, { name: "Owner", role: "ADMIN", active: true }, adminActor)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const ownerActor = { id: o.id, email: o.email, name: o.name, role: o.role };
    await expect(updateStaff(o.id, { name: "Owner", role: "OWNER", active: false }, ownerActor)).rejects.toMatchObject({ code: "SELF_CHANGE" });
    const o2 = await createStaff({ email: "o2@example.com", name: "O2", role: "OWNER", password: PASSWORD }, ownerActor);
    await updateStaff(o2.id, { name: "O2", role: "ADMIN", active: true }, ownerActor);
    expect((await prisma.staffUser.findUniqueOrThrow({ where: { id: o2.id } })).role).toBe("ADMIN");
    await expect(updateStaff(o.id, { name: "Owner", role: "ADMIN", active: true }, { id: o2.id, email: "", name: "", role: "OWNER" })).rejects.toMatchObject({ code: "LAST_OWNER" });
  });
});

describe("settings", () => {
  it("validates, audits and drives checkout", async () => {
    const f = await seedFixture();
    await expect(updateSettings({ "checkout.paymentWindowMinutes": 1 }, "staff")).rejects.toThrow();
    await expect(updateSettings({ "store.contactEmail": "not-an-email" }, "staff")).rejects.toThrow();

    await updateSettings({ "checkout.open": false }, "staff");
    const closed = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]));
    expect(closed).toMatchObject({ status: 503, body: { code: "CHECKOUT_CLOSED" } });

    await updateSettings({ "checkout.open": true, "checkout.paymentWindowMinutes": 10 }, "staff");
    const res = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]));
    const minutes = (new Date(res.body.paymentExpiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "SETTINGS_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(audit.metadata).toMatchObject({ "checkout.paymentWindowMinutes": { from: 30, to: 10 } });
    expect((await getSettings())["storefront.previewMode"]).toBe(true); // untouched default
  });
});

describe("stock control", () => {
  it("receipts, adjustments and stocktakes are recorded and can never undercut reserved stock", async () => {
    const f = await seedFixture({ crispsStock: 5 });
    await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 3 }]));

    expect(await changeStock({ variantId: f.crisps, locationId: f.location.id, mode: "delta", quantity: 10, reason: "RECEIPT", note: "Delivery 42" }, "staff")).toMatchObject({ onHand: 15 });
    await expect(changeStock({ variantId: f.crisps, locationId: f.location.id, mode: "count", quantity: 2, reason: "STOCKTAKE", note: "" }, "staff")).rejects.toMatchObject({ code: "BELOW_RESERVED" });
    await expect(changeStock({ variantId: f.crisps, locationId: f.location.id, mode: "delta", quantity: -13, reason: "DAMAGE", note: "" }, "staff")).rejects.toMatchObject({ code: "BELOW_RESERVED" });
    expect(await changeStock({ variantId: f.crisps, locationId: f.location.id, mode: "count", quantity: 4, reason: "STOCKTAKE", note: "Count" }, "staff")).toMatchObject({ onHand: 4, delta: -11 });

    const movements = await prisma.inventoryMovement.findMany({ where: { variantId: f.crisps }, orderBy: { createdAt: "asc" } });
    expect(movements.map((m) => [m.reason, m.quantityDelta])).toEqual([["RECEIPT", 10], ["STOCKTAKE", -11]]);
    expect(await inventoryInvariantViolations()).toEqual([]);
  });
});

describe("catalogue, markets and shipping", () => {
  it("creates sellable products end to end and enforces uniqueness and price rules", async () => {
    const f = await seedFixture();
    const ng = await prisma.market.findUniqueOrThrow({ where: { code: "NG" } });
    const category = await saveCategory(null, { name: "Spices", slug: "spices", sortOrder: 1, status: "ACTIVE" }, "staff");
    const product = await saveProduct(null, { name: "Suya Spice", slug: "suya-spice", description: "Peanut and chilli spice blend.", brand: "Dorocity", categoryId: category.id, originCountry: "ng", status: "ACTIVE" }, "staff");
    await expect(saveProduct(null, { name: "Dup", slug: "suya-spice", description: "Another description", originCountry: "NG", status: "DRAFT" }, "staff")).rejects.toMatchObject({ code: "DUPLICATE" });

    const variant = await saveVariant(product.id, null, { sku: "dor-spc-009", packSize: "100 g", weightGrams: 120, status: "ACTIVE" }, "staff");
    expect(variant.sku).toBe("DOR-SPC-009");
    await expect(saveMarketPrice(variant.id, ng.id, { priceMinor: BigInt(100000), compareAtMinor: BigInt(90000), exportEligible: false, minShelfLifeDays: null, status: "ACTIVE" }, "staff")).rejects.toMatchObject({ code: "INVALID_COMPARE_AT" });
    await saveMarketPrice(variant.id, ng.id, { priceMinor: BigInt(125000), compareAtMinor: null, exportEligible: false, minShelfLifeDays: null, status: "ACTIVE" }, "staff");
    await changeStock({ variantId: variant.id, locationId: f.location.id, mode: "delta", quantity: 7, reason: "RECEIPT", note: "" }, "staff");

    const products = await api.products("?market=NG&q=suya");
    expect(products.body.data).toEqual([expect.objectContaining({ variantId: variant.id, priceMinor: "125000", currency: "NGN", available: true, category: "Spices" })]);
    expect((await api.checkout(checkoutBody([{ variantId: variant.id, quantity: 2 }]))).status).toBe(201);
  });

  it("new markets work at checkout once they have prices and an enabled, priced shipping rule", async () => {
    const f = await seedFixture();
    const us = await saveMarket(null, { code: "US", name: "United States", countryCode: "US", currency: "USD", status: "ACTIVE" }, "staff");
    await expect(saveShippingRule(us.id, null, { countryCode: "US", providerCode: "DHL", enabled: true, flatRateMinor: null, minOrderMinor: null, maxWeightGrams: null }, "staff")).rejects.toMatchObject({ code: "RATE_REQUIRED" });
    await expect(saveShippingRule(us.id, null, { countryCode: "GB", providerCode: "DHL", enabled: false, flatRateMinor: null, minOrderMinor: null, maxWeightGrams: null }, "staff")).rejects.toMatchObject({ code: "RULE_COUNTRY_MISMATCH" });
    await saveShippingRule(us.id, null, { countryCode: "US", providerCode: "DHL", enabled: true, flatRateMinor: BigInt(2500), minOrderMinor: null, maxWeightGrams: null }, "staff");
    await saveMarketPrice(f.tea, us.id, { priceMinor: BigInt(1500), compareAtMinor: null, exportEligible: true, minShelfLifeDays: 90, status: "ACTIVE" }, "staff");

    const res = await api.checkout(checkoutBody([{ variantId: f.tea, quantity: 1 }], { market: "US", countryCode: "US" }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ currency: "USD", totalMinor: "4000" });
    await expect(saveMarket(us.id, { code: "US", name: "United States", countryCode: "US", currency: "CAD", status: "ACTIVE" }, "staff")).rejects.toMatchObject({ code: "CURRENCY_LOCKED" });
  });
});

describe("order operations", () => {
  it("cancelling an unpaid order releases its stock", async () => {
    const f = await seedFixture({ crispsStock: 2 });
    const res = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 2 }]));
    const order = await orderByNumber(res.body.orderNumber);
    await cancelUnpaidOrder(order.id, "staff", "Customer asked");
    expect((await orderByNumber(order.orderNumber)).status).toBe("CANCELLED");
    expect((await balance(f.crisps)).reservedQuantity).toBe(0);
    await expect(cancelUnpaidOrder(order.id, "staff", "again")).rejects.toMatchObject({ code: "ORDER_NOT_CANCELLABLE" });
  });

  it("payment review: refund returns what was actually charged, not the order total", async () => {
    const f = await seedFixture();
    const res = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]));
    paystack.pay(res.body.payment.reference, { amount: 100000 }); // underpaid: order total is 335000
    await api.webhook(paystack.chargeSuccessWebhook(res.body.payment.reference));
    const order = await orderByNumber(res.body.orderNumber);
    expect(order.status).toBe("PAYMENT_REVIEW");

    await resolvePaymentReview(order.id, "REFUND", "finance", "Short payment");
    const after = await orderByNumber(order.orderNumber);
    expect(after.payments[0].refunds[0].amountMinor).toBe(BigInt(100000));
    expect(paystack.refunds).toEqual([expect.objectContaining({ amount: 100000 })]);
    expect(after.status).toBe("REFUND_PENDING");
  });

  it("payment review: accepting allocates stock and confirms", async () => {
    const f = await seedFixture({ crispsStock: 1 });
    const res = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]));
    paystack.pay(res.body.payment.reference, { amount: 335001 });
    await api.webhook(paystack.chargeSuccessWebhook(res.body.payment.reference));
    const order = await orderByNumber(res.body.orderNumber);
    await resolvePaymentReview(order.id, "ACCEPT", "finance", "Overpaid by 1 kobo; accepted");
    const after = await orderByNumber(order.orderNumber);
    expect(after.status).toBe("CONFIRMED");
    expect(after.reservations.filter((r) => r.status === "COMMITTED")).toHaveLength(1);
    expect(await inventoryInvariantViolations()).toEqual([]);
  });

  it("manual shipment, dispatch and delivery", async () => {
    const f = await seedFixture({ crispsStock: 3 });
    const order = await paidOrder(f.crisps, 2);
    await createManualShipment(order.id, { carrier: "GIG Logistics", trackingNumber: "GIG123" }, "ops");
    let current = await orderByNumber(order.orderNumber);
    expect(current.shipments[0]).toMatchObject({ status: "READY", trackingNumber: "GIG123", providerCode: "MANUAL:GIG Logistics" });
    await dispatchShipment(current.shipments[0].id, "ops");
    await markShipmentDelivered(current.shipments[0].id, "ops");
    current = await orderByNumber(order.orderNumber);
    expect(current.status).toBe("DELIVERED");
    expect(await balance(f.crisps)).toMatchObject({ quantityOnHand: 1, reservedQuantity: 0 });
  });

  it("an UNKNOWN refund can be resolved after checking Paystack", async () => {
    const f = await seedFixture();
    const order = await paidOrder(f.crisps);
    paystack.failNext("/refund", "lost-response");
    const refund = await requestRefund({ orderId: order.id, reason: "Cancelled", actorId: "finance", idempotencyKey: "k1" });
    expect(refund.providerCallState).toBe("UNKNOWN");
    await resolveRefundManually(refund.id, "REFUNDED", "finance", "Seen in Paystack dashboard", String(paystack.refunds[0].id));
    const after = await orderByNumber(order.orderNumber);
    expect(after.status).toBe("REFUNDED");
    expect(after.payments[0].status).toBe("REFUNDED");
    await expect(resolveRefundManually(refund.id, "FAILED", "finance", "again")).rejects.toMatchObject({ code: "REFUND_ALREADY_FINAL" });
  });

  it("failed webhook events can be reprocessed; reconciliation runs are recorded", async () => {
    const f = await seedFixture();
    const res = await api.checkout(checkoutBody([{ variantId: f.crisps, quantity: 1 }]));
    paystack.pay(res.body.payment.reference);
    paystack.failNext("/transaction/verify/", "server-error");
    await api.webhook(paystack.chargeSuccessWebhook(res.body.payment.reference));
    const event = await prisma.paymentEvent.findFirstOrThrow();
    expect(event.status).toBe("FAILED");
    expect(await reprocessPaymentEvent(event.id, "finance")).toBe("PROCESSED");
    expect((await orderByNumber(res.body.orderNumber)).status).toBe("CONFIRMED");

    await runReconciliationJob("staff:test");
    expect(await prisma.jobRun.findFirstOrThrow()).toMatchObject({ name: "reconcile", status: "SUCCEEDED", triggeredBy: "staff:test" });
  });
});
