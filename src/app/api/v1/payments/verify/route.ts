import { NextResponse } from "next/server";
import { z } from "zod";
import { CommerceError, errorResponse, readJsonBody } from "@/lib/commerce/errors";
import { confirmPaymentByReference } from "@/lib/commerce/payments";

export const dynamic = "force-dynamic";

const schema = z.object({ reference: z.string().regex(/^DFP_[a-f0-9]{32}$/) });

/**
 * Lets a customer (or a client that lost the checkout response) ask for the
 * outcome of a payment. Status is decided by server-to-server verification only.
 */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await readJsonBody(request, 1024));
    if (!parsed.success) throw new CommerceError("INVALID_REFERENCE", 400, "Invalid payment reference.");
    const status = await confirmPaymentByReference(parsed.data.reference);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
