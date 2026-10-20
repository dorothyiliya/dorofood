import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/commerce/errors";
import { createCheckout } from "@/lib/commerce/checkout";

export const dynamic = "force-dynamic";

/** Creates a pending order, reserves stock and returns the payment provider's hosted payment URL. Disabled unless CHECKOUT_ENABLED=true. */
export async function POST(request: Request) {
  try {
    const result = await createCheckout(await readJsonBody(request), request.headers.get("idempotency-key"));
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
