import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * In-process stand-in for the Paystack REST API (initialize, verify, refund),
 * plus helpers to simulate the customer paying and Paystack sending webhooks.
 * The application's real HTTP client code talks to it over a socket.
 */
type Tx = { id: number; reference: string; amount: number; currency: string; email: string; status: string; paid_at: string | null; refunded: number; callback_url?: string };

/** `interactive` serves a local stand-in for Paystack's payment page (for clicking through checkout locally). */
export type FakePaystackOptions = { secret?: string; interactive?: { webhookUrl: string } };
type Fault = "network" | "server-error" | "reject" | "lost-response";

export class FakePaystack {
  readonly secret: string;
  readonly transactions = new Map<string, Tx>();
  readonly refunds: { id: number; transaction: string; amount: number }[] = [];
  readonly calls: { method: string; path: string }[] = [];
  private faults = new Map<string, Fault[]>();
  private server: Server | null = null;
  private nextId = 1000;
  baseUrl = "";

  constructor(private readonly options: FakePaystackOptions = {}) {
    this.secret = options.secret ?? `sk_test_${randomBytes(16).toString("hex")}`;
  }

  async start(port = 0) {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  reset() {
    this.transactions.clear();
    this.refunds.length = 0;
    this.calls.length = 0;
    this.faults.clear();
  }

  /** Queue a fault for the next request whose path starts with `prefix`. */
  failNext(prefix: string, fault: Fault, times = 1) {
    this.faults.set(prefix, [...(this.faults.get(prefix) ?? []), ...Array(times).fill(fault)]);
  }

  /** The customer completes payment on Paystack's page (optionally a tampered amount). */
  pay(reference: string, override: { amount?: number; currency?: string } = {}) {
    const tx = this.transactions.get(reference);
    if (!tx) throw new Error(`Unknown reference ${reference}`);
    Object.assign(tx, { status: "success", paid_at: new Date().toISOString() }, override);
    return tx;
  }

  decline(reference: string) {
    const tx = this.transactions.get(reference)!;
    tx.status = "failed";
  }

  /** A signed webhook exactly as Paystack would deliver it. */
  webhook(event: string, data: Record<string, unknown>, secret = this.secret) {
    const body = JSON.stringify({ event, data });
    return { body, signature: createHmac("sha512", secret).update(body).digest("hex") };
  }

  chargeSuccessWebhook(reference: string) {
    const tx = this.transactions.get(reference)!;
    // Deliberately uses the transaction state at send time; the app must re-verify anyway.
    return this.webhook("charge.success", { id: tx.id, reference, amount: tx.amount, currency: tx.currency, status: tx.status, paid_at: tx.paid_at });
  }

  private takeFault(path: string) {
    for (const [prefix, queue] of this.faults) {
      if (path.startsWith(prefix) && queue.length) return queue.shift()!;
    }
    return null;
  }

  private send(res: ServerResponse, status: number, payload: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const path = req.url ?? "";
    this.calls.push({ method: req.method ?? "", path });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (this.options.interactive && path.startsWith("/pay/")) return this.payPage(req.method ?? "GET", path, res);
    const body = raw ? JSON.parse(raw) : {};

    if (req.headers.authorization !== `Bearer ${this.secret}`) return this.send(res, 401, { status: false, message: "Invalid key" });

    const fault = this.takeFault(path);
    if (fault === "network") return req.socket.destroy();
    if (fault === "server-error") return this.send(res, 503, { status: false, message: "Service unavailable" });
    if (fault === "reject") return this.send(res, 400, { status: false, message: "Rejected by fake provider" });

    let status = 200;
    let payload: unknown;
    if (req.method === "POST" && path === "/transaction/initialize") {
      if (this.transactions.has(body.reference)) {
        status = 400; payload = { status: false, message: "Duplicate Transaction Reference" };
      } else {
        const tx: Tx = { id: this.nextId++, reference: body.reference, amount: Number(body.amount), currency: body.currency, email: body.email, status: "abandoned", paid_at: null, refunded: 0, callback_url: body.callback_url };
        this.transactions.set(tx.reference, tx);
        const url = this.options.interactive ? `${this.baseUrl}/pay/${tx.reference}` : `https://checkout.paystack.test/${tx.id}`;
        payload = { status: true, message: "Authorization URL created", data: { authorization_url: url, access_code: `ac_${tx.id}`, reference: tx.reference } };
      }
    } else if (req.method === "GET" && path.startsWith("/transaction/verify/")) {
      const tx = this.transactions.get(decodeURIComponent(path.slice("/transaction/verify/".length)));
      if (!tx) { status = 400; payload = { status: false, message: "Transaction reference not found" }; }
      else payload = { status: true, message: "Verification successful", data: { id: tx.id, reference: tx.reference, amount: tx.amount, currency: tx.currency, status: tx.status, paid_at: tx.paid_at } };
    } else if (req.method === "POST" && path === "/refund") {
      const tx = this.transactions.get(body.transaction);
      const amount = body.amount === undefined ? (tx ? tx.amount - tx.refunded : 0) : Number(body.amount);
      if (!tx || tx.status !== "success") { status = 400; payload = { status: false, message: "Transaction has not been completed" }; }
      else if (amount <= 0 || tx.refunded + amount > tx.amount) { status = 400; payload = { status: false, message: "Refund amount cannot be more than transaction amount" }; }
      else {
        tx.refunded += amount;
        const refund = { id: this.nextId++, transaction: tx.reference, amount };
        this.refunds.push(refund);
        payload = { status: true, message: "Refund has been queued for processing", data: { id: refund.id, amount, status: "pending", currency: tx.currency, transaction: { id: tx.id, reference: tx.reference } } };
      }
    } else {
      status = 404; payload = { status: false, message: "Not found" };
    }

    if (fault === "lost-response") return req.socket.destroy(); // the request took effect; the caller never hears back
    this.send(res, status, payload);
  }

  /** Local stand-in for Paystack's hosted payment page. Never used against real Paystack. */
  private async payPage(method: string, path: string, res: ServerResponse) {
    const [, , reference, action] = path.split("?")[0].split("/");
    const tx = this.transactions.get(decodeURIComponent(reference ?? ""));
    if (!tx) return this.send(res, 404, { status: false, message: "Unknown payment" });
    if (method === "POST" && (action === "success" || action === "decline")) {
      if (action === "success") this.pay(tx.reference); else this.decline(tx.reference);
      if (action === "success") {
        const delivery = this.chargeSuccessWebhook(tx.reference);
        await fetch(this.options.interactive!.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": delivery.signature }, body: delivery.body }).catch(() => undefined);
      }
      const back = new URL(tx.callback_url ?? "http://localhost:3000/checkout/complete");
      back.searchParams.set("trxref", tx.reference);
      back.searchParams.set("reference", tx.reference);
      res.writeHead(303, { Location: back.toString() });
      return res.end();
    }
    const amount = new Intl.NumberFormat("en-NG", { style: "currency", currency: tx.currency }).format(tx.amount / 100);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fake Paystack</title>
<style>body{font-family:system-ui;background:#f3f4f6;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;padding:32px;border-radius:16px;max-width:360px;width:100%;box-shadow:0 10px 30px #0001}button{width:100%;padding:14px;border-radius:10px;border:0;font-size:16px;margin-top:10px;cursor:pointer}.pay{background:#0ba4db;color:#fff}.no{background:#eee}</style></head>
<body><main><p style="color:#b45309;font-weight:600">LOCAL TEST PAYMENT PAGE (not Paystack)</p><p>${tx.email}</p><h1>${amount}</h1>
<form method="post" action="/pay/${tx.reference}/success"><button class="pay">Pay ${amount}</button></form>
<form method="post" action="/pay/${tx.reference}/decline"><button class="no">Decline</button></form></main></body></html>`);
  }
}
