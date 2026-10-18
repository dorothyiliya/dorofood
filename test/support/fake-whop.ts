import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * In-process stand-in for the Whop REST API (checkout configurations, payments,
 * refunds) plus Standard-Webhooks-signed deliveries, as documented at docs.whop.com.
 */
type Checkout = { id: string; plan: { initial_price: number; currency: string; company_id: string }; metadata: Record<string, string>; redirect_url: string };
type Payment = {
  id: string; status: string; substatus: string; total: number; currency: string; metadata: Record<string, string>;
  checkout_configuration_id: string; paid_at: string | null; refunded_amount: number;
  refunds: { id: string; status: string; amount: number; currency: string; created_at: string }[];
};

export class FakeWhop {
  readonly apiKey = `apik_${randomBytes(12).toString("hex")}`;
  readonly webhookSecret = `ws_${randomBytes(16).toString("hex")}`;
  readonly companyId = "biz_testcompany";
  readonly checkouts = new Map<string, Checkout>();
  readonly payments = new Map<string, Payment>();
  readonly calls: { method: string; path: string; body?: unknown }[] = [];
  private faults: { prefix: string; kind: "server-error" | "network" | "reject" }[] = [];
  private server: Server | null = null;
  private n = 1;
  baseUrl = "";

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  async stop() { await new Promise<void>((r) => this.server?.close(() => r()) ?? r()); }

  reset() { this.checkouts.clear(); this.payments.clear(); this.calls.length = 0; this.faults = []; }

  failNext(prefix: string, kind: "server-error" | "network" | "reject") { this.faults.push({ prefix, kind }); }

  checkoutFor(reference: string) {
    return [...this.checkouts.values()].find((c) => c.metadata.reference === reference);
  }

  /** The customer pays on Whop's hosted page. */
  pay(reference: string, override: Partial<Pick<Payment, "total" | "currency" | "status" | "substatus">> = {}) {
    const checkout = this.checkoutFor(reference);
    if (!checkout) throw new Error(`No checkout for ${reference}`);
    const payment: Payment = {
      id: `pay_${String(this.n++).padStart(8, "0")}`, status: "paid", substatus: "succeeded",
      total: checkout.plan.initial_price, currency: checkout.plan.currency, metadata: checkout.metadata,
      checkout_configuration_id: checkout.id, paid_at: new Date().toISOString(), refunded_amount: 0, refunds: [], ...override,
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  /** A signed delivery exactly as Whop sends it (Standard Webhooks). */
  webhook(type: string, data: unknown, opts: { secret?: string; id?: string; timestamp?: number } = {}) {
    const id = opts.id ?? `msg_${randomBytes(8).toString("hex")}`;
    const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ id, type, api_version: "v1", timestamp: new Date().toISOString(), data });
    const signature = createHmac("sha256", Buffer.from(opts.secret ?? this.webhookSecret, "utf8")).update(`${id}.${timestamp}.${body}`).digest("base64");
    return { body, headers: { id, timestamp, signature: `v1,${signature}` } };
  }

  private send(res: ServerResponse, status: number, payload: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    this.calls.push({ method: req.method ?? "", path: url.pathname + url.search, body });
    if (req.headers.authorization !== `Bearer ${this.apiKey}`) return this.send(res, 401, { error: { message: "Unauthorized" } });

    const fault = this.faults.findIndex((f) => url.pathname.startsWith(f.prefix));
    if (fault > -1) {
      const [{ kind }] = this.faults.splice(fault, 1);
      if (kind === "network") return req.socket.destroy();
      if (kind === "server-error") return this.send(res, 503, { error: { message: "Unavailable" } });
      return this.send(res, 400, { error: { message: "Rejected by fake Whop" } });
    }

    if (req.method === "POST" && url.pathname === "/checkout_configurations") {
      const plan = body?.plan;
      if (body?.mode !== "payment" || !plan || plan.plan_type !== "one_time" || plan.company_id !== this.companyId || typeof plan.initial_price !== "number") {
        return this.send(res, 400, { error: { message: "Invalid checkout configuration" } });
      }
      const checkout: Checkout = { id: `ch_${String(this.n++).padStart(8, "0")}`, plan, metadata: body.metadata ?? {}, redirect_url: body.redirect_url };
      this.checkouts.set(checkout.id, checkout);
      return this.send(res, 200, { ...checkout, company_id: this.companyId, mode: "payment", currency: plan.currency, purchase_url: `/checkout/${checkout.id}/` });
    }
    if (req.method === "GET" && url.pathname === "/payments") {
      const ids = url.searchParams.getAll("checkout_configuration_ids");
      const data = [...this.payments.values()].filter((p) => ids.includes(p.checkout_configuration_id));
      return this.send(res, 200, { data, page_info: { has_next_page: false } });
    }
    const one = /^\/payments\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && one) {
      const p = this.payments.get(decodeURIComponent(one[1]));
      return p ? this.send(res, 200, p) : this.send(res, 404, { error: { message: "Not found" } });
    }
    const refund = /^\/payments\/([^/]+)\/refund$/.exec(url.pathname);
    if (req.method === "POST" && refund) {
      const p = this.payments.get(decodeURIComponent(refund[1]));
      if (!p || p.status !== "paid") return this.send(res, 400, { error: { message: "Payment is not refundable" } });
      const amount = typeof body?.partial_amount === "number" ? body.partial_amount : p.total - p.refunded_amount;
      if (amount <= 0 || p.refunded_amount + amount > p.total + 1e-9) return this.send(res, 400, { error: { message: "Refund exceeds payment" } });
      p.refunded_amount += amount;
      p.refunds.unshift({ id: `rf_${String(this.n++).padStart(8, "0")}`, status: "pending", amount, currency: p.currency, created_at: new Date().toISOString() });
      p.substatus = p.refunded_amount >= p.total ? "refunded" : "partially_refunded";
      return this.send(res, 200, p);
    }
    this.send(res, 404, { error: { message: "Not found" } });
  }
}
