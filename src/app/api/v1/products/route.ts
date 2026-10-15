import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getFulfilmentLocationCode, isDatabaseConfigured } from "@/lib/env";
import { errorResponse } from "@/lib/commerce/errors";
import { marketCodeSchema } from "@/lib/commerce/pricing";

export const dynamic = "force-dynamic";

/** Authoritative catalogue: database prices and live availability for one market. */
export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "The product catalogue is not connected yet.", code: "CATALOGUE_NOT_CONFIGURED" }, { status: 503 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const market = marketCodeSchema.safeParse((searchParams.get("market") || "NG").toUpperCase());
    if (!market.success) return NextResponse.json({ error: "Unknown market.", code: "INVALID_MARKET" }, { status: 400 });
    const query = (searchParams.get("q") || "").trim().slice(0, 100);
    const category = (searchParams.get("category") || "").trim().toLowerCase();
    const requested = Number.parseInt(searchParams.get("limit") || "24", 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 24;

    const marketRow = await prisma.market.findUnique({ where: { code: market.data } });
    if (!marketRow || marketRow.status !== "ACTIVE") {
      return NextResponse.json({ data: [], meta: { count: 0, market: market.data, available: false } });
    }

    const rows = await prisma.marketProduct.findMany({
      where: {
        marketId: marketRow.id,
        status: "ACTIVE",
        variant: {
          status: "ACTIVE",
          product: {
            status: "ACTIVE",
            ...(category && category !== "all" ? { category: { slug: category } } : {}),
            ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { brand: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] } : {}),
          },
        },
      },
      include: {
        variant: {
          include: {
            product: { include: { category: true } },
            balances: { where: { location: { code: getFulfilmentLocationCode() } } },
          },
        },
      },
      orderBy: { variant: { product: { name: "asc" } } },
      take: limit,
    });

    return NextResponse.json({
      data: rows.map(({ variant, priceMinor, currency, exportEligible }) => ({
        variantId: variant.id,
        sku: variant.sku,
        slug: variant.product.slug,
        name: variant.product.name,
        brand: variant.product.brand,
        category: variant.product.category?.name ?? null,
        packSize: variant.packSize,
        description: variant.product.description,
        priceMinor: priceMinor.toString(),
        currency,
        available: variant.balances.some((b) => b.quantityOnHand - b.reservedQuantity > 0),
        origin: variant.product.originCountry,
        exportEligible,
      })),
      meta: { count: rows.length, market: market.data, currency: marketRow.currency, source: "database" },
    }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
  } catch (error) {
    return errorResponse(error);
  }
}
