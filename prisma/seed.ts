import { PrismaClient, RecordStatus } from "@prisma/client";

const prisma = new PrismaClient();

// Demo data only. Re-running is safe: stock is set when a balance is first
// created and is never overwritten, so live reservations cannot be corrupted.
async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo data into a production environment.");
  }

  const categoryNames = ["Snacks", "Drinks", "Pantry", "Breakfast", "Treats"];
  const categoryMap = new Map<string, string>();

  for (const name of categoryNames) {
    const category = await prisma.category.upsert({
      where: { slug: name.toLowerCase() },
      update: { name, status: RecordStatus.ACTIVE },
      create: { name, slug: name.toLowerCase(), status: RecordStatus.ACTIVE },
    });
    categoryMap.set(name, category.id);
  }

  const market = await prisma.market.upsert({
    where: { code: "NG" },
    update: { name: "Nigeria", countryCode: "NG", currency: "NGN" },
    create: { code: "NG", name: "Nigeria", countryCode: "NG", currency: "NGN", status: "ACTIVE" },
  });

  // Delivery stays disabled until a real rate is agreed with a carrier; checkout fails closed until then.
  const existingRule = await prisma.shippingRule.findFirst({ where: { marketId: market.id, countryCode: "NG" } });
  if (!existingRule) {
    await prisma.shippingRule.create({ data: { marketId: market.id, countryCode: "NG", providerCode: "UNCONFIGURED", enabled: false, currency: "NGN" } });
  }

  const location = await prisma.inventoryLocation.upsert({
    where: { code: "NG-MAIN" },
    update: { name: "Main fulfilment location" },
    create: { code: "NG-MAIN", name: "Main fulfilment location", addressJson: { countryCode: "NG", note: "Configure the actual warehouse address before production." } },
  });

  // Matches the storefront preview catalogue (src/lib/catalogue.ts) by slug.
  const items = [
    { slug: "golden-plantain-crisps", name: "Golden Plantain Crisps", brand: "Dorocity Select", category: "Snacks", sku: "DOR-SNK-001", packSize: "150 g", grams: 180, price: 185000, stock: 48 },
    { slug: "cocoa-cashew-bites", name: "Cocoa Cashew Bites", brand: "Little Indulgence", category: "Treats", sku: "DOR-TRT-002", packSize: "120 g", grams: 150, price: 320000, stock: 24 },
    { slug: "hibiscus-ginger-sparkler", name: "Hibiscus & Ginger Sparkler", brand: "Good Day Drinks", category: "Drinks", sku: "DOR-DRK-003", packSize: "330 ml · 4 pack", grams: 1500, price: 480000, stock: 32 },
    { slug: "morning-oats-and-seeds", name: "Morning Oats & Seeds", brand: "Everyday Ritual", category: "Breakfast", sku: "DOR-BRK-004", packSize: "500 g", grams: 540, price: 425000, stock: 19 },
    { slug: "smoky-pepper-seasoning", name: "Smoky Pepper Seasoning", brand: "The Pantry Edit", category: "Pantry", sku: "DOR-PAN-005", packSize: "90 g", grams: 120, price: 210000, stock: 36 },
    { slug: "roasted-groundnut-crunch", name: "Roasted Groundnut Crunch", brand: "Dorocity Select", category: "Snacks", sku: "DOR-SNK-006", packSize: "200 g", grams: 230, price: 160000, stock: 61 },
    { slug: "citrus-black-tea", name: "Citrus Black Tea", brand: "Everyday Ritual", category: "Breakfast", sku: "DOR-BRK-007", packSize: "20 tea bags", grams: 60, price: 390000, stock: 27 },
    { slug: "coconut-cocoa-granola", name: "Coconut Cocoa Granola", brand: "Morning People", category: "Breakfast", sku: "DOR-BRK-008", packSize: "350 g", grams: 390, price: 560000, stock: 14 },
  ];

  for (const item of items) {
    const description = `${item.name}: demo catalogue content; replace with verified supplier information.`;
    const product = await prisma.product.upsert({
      where: { slug: item.slug },
      update: { name: item.name, description, brand: item.brand, categoryId: categoryMap.get(item.category) },
      create: { slug: item.slug, name: item.name, description, brand: item.brand, categoryId: categoryMap.get(item.category), status: RecordStatus.ACTIVE, originCountry: "NG" },
    });
    const variant = await prisma.productVariant.upsert({
      where: { sku: item.sku },
      update: { productId: product.id, packSize: item.packSize, weightGrams: item.grams },
      create: { productId: product.id, sku: item.sku, packSize: item.packSize, weightGrams: item.grams, status: RecordStatus.ACTIVE },
    });

    await prisma.marketProduct.upsert({
      where: { marketId_variantId: { marketId: market.id, variantId: variant.id } },
      update: { priceMinor: BigInt(item.price), currency: "NGN" },
      create: { marketId: market.id, variantId: variant.id, priceMinor: BigInt(item.price), currency: "NGN", status: RecordStatus.ACTIVE, exportEligible: false },
    });

    const balance = await prisma.inventoryBalance.findUnique({ where: { variantId_locationId: { variantId: variant.id, locationId: location.id } } });
    if (!balance) {
      await prisma.$transaction([
        prisma.inventoryBalance.create({ data: { variantId: variant.id, locationId: location.id, quantityOnHand: item.stock, reservedQuantity: 0 } }),
        prisma.inventoryMovement.create({ data: { variantId: variant.id, locationId: location.id, quantityDelta: item.stock, reason: "RECEIPT", reference: "demo-seed", note: "Demo stock; not real inventory." } }),
      ]);
    }
  }

  console.log("Dorocity demo catalogue seeded. Replace all demo prices, stock and descriptions before production.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
