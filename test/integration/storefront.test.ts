import { describe, expect, it } from "vitest";
import { loadStorefront } from "@/lib/storefront-data";
import { addProductImage, makePrimaryImage, saveMarketPrice } from "@/lib/admin/catalogue";
import { changeStock } from "@/lib/admin/stock";
import { updateSettings } from "@/lib/settings";
import { prisma, seedFixture, setupIntegrationHarness } from "../support/harness";

setupIntegrationHarness();

describe("storefront reflects the admin", () => {
  it("serves database products with prices, photos, stock and per-market eligibility", async () => {
    const f = await seedFixture({ crispsStock: 0, teaStock: 4 });
    const tea = await prisma.productVariant.findUniqueOrThrow({ where: { id: f.tea } });
    await addProductImage(tea.productId, { url: "https://images.example.com/tea.jpg", altText: "Citrus tea pack" }, "staff");

    const data = await loadStorefront();
    expect(data.source).toBe("database");
    const crisps = data.products.find((p) => p.id === f.crisps)!;
    const teaCard = data.products.find((p) => p.id === f.tea)!;
    expect(crisps).toMatchObject({ priceKobo: 185000, available: false, shipsTo: ["NG"], images: [] });
    expect(teaCard).toMatchObject({ available: true, images: [{ url: "https://images.example.com/tea.jpg", alt: "Citrus tea pack" }] });
    expect(teaCard.shipsTo.sort()).toEqual(["GB", "NG"]);
    expect(data.markets[0]).toMatchObject({ code: "NG", delivers: true, flatRateMinor: "150000" });
    // Neighbouring products never share a pack colour.
    expect(data.products[0].pack.color).not.toBe(data.products[1].pack.color);

    await changeStock({ variantId: f.crisps, locationId: f.location.id, mode: "delta", quantity: 5, reason: "RECEIPT", note: "" }, "staff");
    const ng = await prisma.market.findUniqueOrThrow({ where: { code: "NG" } });
    await saveMarketPrice(f.crisps, ng.id, { priceMinor: BigInt(199000), compareAtMinor: BigInt(250000), exportEligible: false, minShelfLifeDays: null, status: "ACTIVE" }, "staff");
    const after = (await loadStorefront()).products.find((p) => p.id === f.crisps)!;
    expect(after).toMatchObject({ priceKobo: 199000, compareAtKobo: 250000, available: true });
  });

  it("reports checkout as live only when every switch is on", async () => {
    await seedFixture();
    expect((await loadStorefront()).checkoutLive).toBe(true); // fixture opens the store; harness sets key + CHECKOUT_ENABLED
    await updateSettings({ "checkout.open": false }, "staff");
    expect((await loadStorefront()).checkoutLive).toBe(false);
    await updateSettings({ "checkout.open": true }, "staff");
    process.env.CHECKOUT_ENABLED = "false";
    expect((await loadStorefront()).checkoutLive).toBe(false);
  });

  it("shows sample products only in preview mode with an empty catalogue", async () => {
    expect((await loadStorefront()).source).toBe("sample");
    await updateSettings({ "storefront.previewMode": false }, "staff");
    const live = await loadStorefront();
    expect(live).toMatchObject({ source: "database", products: [] });
  });

  it("validates product photos", async () => {
    const f = await seedFixture();
    const { productId } = await prisma.productVariant.findUniqueOrThrow({ where: { id: f.crisps } });
    await expect(addProductImage(productId, { url: "http://insecure.example.com/a.jpg", altText: "Pack front" }, "staff")).rejects.toThrow(/https/);
    await expect(addProductImage(productId, { url: "javascript:alert(1)", altText: "Pack front" }, "staff")).rejects.toThrow();
    await expect(addProductImage(productId, { url: "https://img.example.com/a.jpg", altText: "x" }, "staff")).rejects.toThrow(/screen readers/);
    const first = await addProductImage(productId, { url: "https://img.example.com/1.jpg", altText: "Front of pack" }, "staff");
    const second = await addProductImage(productId, { url: "https://img.example.com/2.jpg", altText: "Back of pack" }, "staff");
    await makePrimaryImage(second.id, "staff");
    const ordered = await prisma.productMedia.findMany({ where: { productId }, orderBy: { sortOrder: "asc" } });
    expect(ordered.map((m) => m.id)).toEqual([second.id, first.id]);
    for (let i = 0; i < 6; i++) await addProductImage(productId, { url: `https://img.example.com/x${i}.jpg`, altText: "Extra photo" }, "staff");
    await expect(addProductImage(productId, { url: "https://img.example.com/9.jpg", altText: "One too many" }, "staff")).rejects.toMatchObject({ code: "TOO_MANY_IMAGES" });
    expect(await prisma.auditEvent.count({ where: { action: "PRODUCT_IMAGE_ADDED" } })).toBe(8);
  });
});
