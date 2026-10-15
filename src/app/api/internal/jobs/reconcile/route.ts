import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getCronSecret } from "@/lib/env";
import { errorResponse } from "@/lib/commerce/errors";
import { runReconciliation } from "@/lib/commerce/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(request: Request) {
  const expected = Buffer.from(`Bearer ${getCronSecret()}`);
  const received = Buffer.from(request.headers.get("authorization") || "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Scheduled job (e.g. Vercel Cron every 5 minutes): retries failed webhook
 * events, verifies open payments, expires unpaid orders and sends pending refunds.
 */
async function run(request: Request) {
  try {
    if (!authorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    return NextResponse.json(await runReconciliation(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = run;
export const POST = run;
