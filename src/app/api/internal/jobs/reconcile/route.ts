import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getCronSecret } from "@/lib/env";
import { errorResponse } from "@/lib/commerce/errors";
import { runReconciliationJob } from "@/lib/admin/system";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(request: Request) {
  const expected = Buffer.from(`Bearer ${getCronSecret()}`);
  const received = Buffer.from(request.headers.get("authorization") || "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Scheduled job (vercel.json; daily on the Hobby plan, can be every few minutes on Pro): retries failed webhook
 * events, verifies open payments, expires unpaid orders, sends pending refunds and emails.
 */
async function run(request: Request) {
  try {
    if (!authorised(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    return NextResponse.json(await runReconciliationJob("cron"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = run;
export const POST = run;
