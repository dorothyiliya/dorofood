import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { CommerceError, errorResponse, readJsonBody } from "@/lib/commerce/errors";
import { cartItemsSchema, countryCodeSchema, marketCodeSchema, priceCart } from "@/lib/commerce/pricing";

export const dynamic = "force-dynamic";

const quoteSchema = z.object({ market: marketCodeSchema, countryCode: countryCodeSchema, items: cartItemsSchema });

/** Read-only price and eligibility check using the same rules as checkout. Never reserves stock. */
export async function POST(request: Request) {
  try {
    const parsed = quoteSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new CommerceError("INVALID_QUOTE", 400, "Invalid quote request", z.flattenError(parsed.error));
    if (!isDatabaseConfigured()) throw new CommerceError("SHIPPING_PROVIDER_NOT_CONFIGURED", 503, "Shipping quotes are not configured yet.");

    const priced = await priceCart(prisma, { marketCode: parsed.data.market, countryCode: parsed.data.countryCode, items: parsed.data.items });
    return NextResponse.json({
      market: priced.market.code,
      countryCode: priced.destinationCountry,
      currency: priced.currency,
      subtotalMinor: priced.subtotalMinor.toString(),
      shippingMinor: priced.shippingMinor.toString(),
      totalMinor: priced.totalMinor.toString(),
      requiresExportReview: priced.requiresExport,
      lines: priced.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor.toString(), lineTotalMinor: l.lineTotalMinor.toString() })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
