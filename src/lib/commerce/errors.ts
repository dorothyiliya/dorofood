import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ConfigError } from "@/lib/env";

/** An expected business outcome that maps to a client-visible error code. */
export class CommerceError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CommerceError";
  }
}

export function isUniqueViolation(error: unknown, field?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (!field) return true;
  const target = (error.meta?.target ?? []) as string[] | string;
  return Array.isArray(target) ? target.includes(field) : String(target).includes(field);
}

/**
 * Converts thrown errors into safe responses. Unexpected errors are logged
 * server-side and returned as a generic 500 so internals never leak.
 */
export function errorResponse(error: unknown) {
  if (error instanceof CommerceError) {
    return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.httpStatus });
  }
  if (error instanceof ConfigError) {
    console.error(`[config] ${error.code}: ${error.message}`);
    return NextResponse.json({ error: "This service is not available yet.", code: error.code }, { status: 503 });
  }
  console.error("[unhandled]", error);
  return NextResponse.json({ error: "Something went wrong. Please try again." , code: "INTERNAL_ERROR" }, { status: 500 });
}

export async function readJsonBody(request: Request, maxBytes = 32_768): Promise<unknown> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new CommerceError("PAYLOAD_TOO_LARGE", 413, "Request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new CommerceError("INVALID_JSON", 400, "Request body must be valid JSON.");
  }
}
