import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/commerce/errors";
import { handleWhopWebhook, MAX_WEBHOOK_BYTES } from "@/lib/commerce/webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  try {
    const result = await handleWhopWebhook(rawBody, {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    // Missing credentials -> 503, database unavailable -> 500. Both make Whop redeliver.
    return errorResponse(error);
  }
}
