import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Recorded = { method: string; path: string; headers: IncomingHttpHeaders; body: Buffer; json: unknown };
type Reply = { status?: number; body?: unknown; raw?: string };

/** A tiny programmable HTTP server for provider APIs without a dedicated fake (Resend, NVIDIA, S3). */
export class FakeHttp {
  readonly requests: Recorded[] = [];
  private server: Server | null = null;
  private replies: ((req: Recorded) => Reply | undefined)[] = [];
  baseUrl = "";

  constructor(private readonly fallback: (req: Recorded) => Reply = () => ({ status: 404, body: { error: "not found" } })) {}

  async start() {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      let json: unknown = null;
      try { json = body.length ? JSON.parse(body.toString("utf8")) : null; } catch { json = null; }
      const recorded = { method: req.method ?? "", path: req.url ?? "/", headers: req.headers, body, json };
      this.requests.push(recorded);
      const once = this.replies.shift();
      const reply = once?.(recorded) ?? this.fallback(recorded);
      res.writeHead(reply.status ?? 200, { "Content-Type": reply.raw !== undefined ? "application/xml" : "application/json" });
      res.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  async stop() { await new Promise<void>((r) => this.server?.close(() => r()) ?? r()); }

  reset() { this.requests.length = 0; this.replies = []; }

  /** Overrides the response to the next request only. */
  next(reply: Reply | ((req: Recorded) => Reply)) { this.replies.push(typeof reply === "function" ? reply : () => reply); }
}

/** Resend's send-email API: returns an id, honours Idempotency-Key like the real service. */
export function fakeResend() {
  const seen = new Map<string, string>();
  let n = 0;
  return new FakeHttp((req) => {
    if (req.method !== "POST" || req.path !== "/emails") return { status: 404, body: { message: "not found" } };
    if (!String(req.headers.authorization ?? "").startsWith("Bearer re_")) return { status: 401, body: { message: "API key is invalid" } };
    const key = String(req.headers["idempotency-key"] ?? "");
    const id = (key && seen.get(key)) || `email_${++n}`;
    if (key) seen.set(key, id);
    return { body: { id } };
  });
}
