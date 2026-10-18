import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BRAND } from "@/lib/brand";
import { formatMoney } from "@/lib/money";
import { getEmailConfig, sendEmail } from "@/lib/integrations/email";
import { ProviderRejectedError } from "@/lib/payments/types";

/**
 * Customer emails go through an outbox. The row is written in the same
 * transaction as the state change it announces, so an email is recorded if and
 * only if the change committed; delivery happens after commit, and anything not
 * delivered is retried by the reconciliation job. Each row has a unique dedupe
 * key and is sent with a Resend idempotency key, so a customer never gets the
 * same email twice.
 */

type Tx = Prisma.TransactionClient;
const MAX_ATTEMPTS = 8;

type Line = { name: string; packSize: string; quantity: number; totalMinor: string };
type OrderPayload = { orderNumber: string; currency: string; recipient: string; lines: Line[]; subtotalMinor: string; shippingMinor: string; totalMinor: string };
export type NotificationPayload =
  | ({ kind: "ORDER_CONFIRMED" } & OrderPayload)
  | ({ kind: "ORDER_DISPATCHED"; trackingNumber: string | null; trackingUrl: string | null } & OrderPayload)
  | { kind: "REFUND_PROCESSED"; orderNumber: string; currency: string; recipient: string; amountMinor: string; full: boolean };

async function orderPayload(tx: Tx, orderId: string): Promise<OrderPayload & { email: string }> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  const address = order.shippingAddressJson as { recipient?: string };
  return {
    email: order.email,
    orderNumber: order.orderNumber,
    currency: order.currency,
    recipient: address.recipient ?? "",
    lines: order.items.map((i) => ({ name: i.productNameSnapshot, packSize: i.packSizeSnapshot, quantity: i.quantity, totalMinor: i.lineTotalMinor.toString() })),
    subtotalMinor: order.subtotalMinor.toString(),
    shippingMinor: order.shippingMinor.toString(),
    totalMinor: order.totalMinor.toString(),
  };
}

async function enqueue(tx: Tx, dedupeKey: string, orderId: string, toEmail: string, payload: NotificationPayload) {
  // ON CONFLICT DO NOTHING: a unique violation would abort the surrounding transaction.
  await tx.notification.createMany({
    data: [{ kind: payload.kind, dedupeKey, toEmail, subject: render(payload).subject, payloadJson: payload as Prisma.InputJsonValue, orderId }],
    skipDuplicates: true,
  });
  return dedupeKey;
}

export async function enqueueOrderConfirmed(tx: Tx, orderId: string) {
  const { email, ...order } = await orderPayload(tx, orderId);
  return enqueue(tx, `order-confirmed:${orderId}`, orderId, email, { kind: "ORDER_CONFIRMED", ...order });
}

export async function enqueueOrderDispatched(tx: Tx, orderId: string, shipment: { id: string; trackingNumber: string | null; trackingUrl: string | null }) {
  const { email, ...order } = await orderPayload(tx, orderId);
  return enqueue(tx, `order-dispatched:${shipment.id}`, orderId, email, { kind: "ORDER_DISPATCHED", ...order, trackingNumber: shipment.trackingNumber, trackingUrl: shipment.trackingUrl });
}

export async function enqueueRefundProcessed(tx: Tx, orderId: string, refund: { id: string; amountMinor: bigint; currency: string; full: boolean }) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const address = order.shippingAddressJson as { recipient?: string };
  return enqueue(tx, `refund-processed:${refund.id}`, orderId, order.email, {
    kind: "REFUND_PROCESSED", orderNumber: order.orderNumber, currency: refund.currency, recipient: address.recipient ?? "", amountMinor: refund.amountMinor.toString(), full: refund.full,
  });
}

/** Sends one queued email. Never throws: email trouble must not undo or block commerce. */
export async function deliverNotification(id: string): Promise<"SENT" | "SKIPPED" | "FAILED" | "RETRY" | "NOOP"> {
  try {
    const row = await prisma.notification.findUnique({ where: { id } });
    if (!row || row.status !== "PENDING") return "NOOP";
    const config = await getEmailConfig();
    if (!config) {
      await prisma.notification.updateMany({ where: { id, status: "PENDING" }, data: { status: "SKIPPED", lastError: "Email is not configured in Integrations." } });
      return "SKIPPED";
    }
    const message = render(row.payloadJson as NotificationPayload);
    try {
      const sent = await sendEmail(config, { to: row.toEmail, ...message, idempotencyKey: `notification-${row.id}` });
      await prisma.notification.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: sent.id, attempts: { increment: 1 }, lastError: null } });
      return "SENT";
    } catch (error) {
      const rejected = error instanceof ProviderRejectedError;
      const attempts = row.attempts + 1;
      const final = rejected || attempts >= MAX_ATTEMPTS;
      await prisma.notification.update({ where: { id }, data: { attempts, lastError: String((error as Error).message).slice(0, 1000), ...(final ? { status: "FAILED" } : {}) } });
      return final ? "FAILED" : "RETRY";
    }
  } catch (error) {
    console.error("[notifications] delivery failed", { id, error: (error as Error).message });
    return "RETRY";
  }
}

/** Delivers the notifications a just-committed transaction queued. */
export async function deliverQueued(dedupeKeys: string[]) {
  if (!dedupeKeys.length) return;
  const rows = await prisma.notification.findMany({ where: { dedupeKey: { in: dedupeKeys }, status: "PENDING" }, select: { id: true } }).catch(() => []);
  for (const row of rows) await deliverNotification(row.id);
}

/** Reconciliation: anything still pending (provider was down, or the process died after commit). */
export async function deliverPendingNotifications({ limit = 50 } = {}) {
  const rows = await prisma.notification.findMany({
    where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 30_000) } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const outcomes: Record<string, number> = {};
  for (const row of rows) {
    const outcome = await deliverNotification(row.id);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { examined: rows.length, outcomes };
}

/* ---------------------------------------------------------------- templates */

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (minor: string, currency: string) => formatMoney(minor, currency);
const firstName = (recipient: string) => recipient.trim().split(/\s+/)[0] || "there";
const safeUrl = (url: string | null) => (url && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null);

function layout(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f5f0;font-family:Arial,Helvetica,sans-serif;color:#1f2a1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="font-size:13px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:#2f6b2f">${escape(BRAND.name)}</td></tr>
<tr><td style="padding-top:12px;font-size:22px;font-weight:bold">${escape(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding-top:24px;font-size:12px;color:#6b7280">${escape(BRAND.name)} · ${escape(BRAND.tagline)} Reply to this email if you need help with your order.</td></tr>
</table></td></tr></table></body></html>`;
}

function linesTable(p: OrderPayload) {
  const rows = p.lines.map((l) => `<tr><td style="padding:6px 0">${l.quantity} × ${escape(l.name)} <span style="color:#6b7280">(${escape(l.packSize)})</span></td><td align="right" style="padding:6px 0;white-space:nowrap">${money(l.totalMinor, p.currency)}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid #e5e7eb;font-size:14px">${rows}
<tr><td style="padding:6px 0;border-top:1px solid #e5e7eb">Delivery</td><td align="right" style="padding:6px 0;border-top:1px solid #e5e7eb">${money(p.shippingMinor, p.currency)}</td></tr>
<tr><td style="padding:6px 0;font-weight:bold">Total paid</td><td align="right" style="padding:6px 0;font-weight:bold">${money(p.totalMinor, p.currency)}</td></tr></table>`;
}

function linesText(p: OrderPayload) {
  return [...p.lines.map((l) => `${l.quantity} x ${l.name} (${l.packSize})  ${money(l.totalMinor, p.currency)}`), `Delivery  ${money(p.shippingMinor, p.currency)}`, `Total paid  ${money(p.totalMinor, p.currency)}`].join("\n");
}

export function render(p: NotificationPayload): { subject: string; html: string; text: string } {
  const hello = `Hi ${firstName(p.recipient)},`;
  if (p.kind === "ORDER_CONFIRMED") {
    const intro = `Thank you for your order. Payment has been received and we're getting order ${p.orderNumber} ready.`;
    return {
      subject: `Order ${p.orderNumber} confirmed`,
      html: layout("Your order is confirmed", `<p>${escape(hello)}</p><p>${escape(intro)}</p>${linesTable(p)}<p style="margin-top:16px">We'll email you again when it's on its way.</p>`),
      text: `${hello}\n\n${intro}\n\n${linesText(p)}\n\nWe'll email you again when it's on its way.\n\n${BRAND.name}`,
    };
  }
  if (p.kind === "ORDER_DISPATCHED") {
    const url = safeUrl(p.trackingUrl);
    const tracking = p.trackingNumber ? `Tracking number: ${p.trackingNumber}` : "";
    return {
      subject: `Order ${p.orderNumber} is on its way`,
      html: layout("Your order is on its way", `<p>${escape(hello)}</p><p>Good news: order ${escape(p.orderNumber)} has left us and is on its way to you.</p>${tracking ? `<p><strong>${escape(tracking)}</strong>${url ? `<br><a href="${escape(url)}" style="color:#2f6b2f">Track your parcel</a>` : ""}</p>` : ""}${linesTable(p)}`),
      text: `${hello}\n\nGood news: order ${p.orderNumber} has left us and is on its way to you.\n${tracking ? `\n${tracking}${url ? `\nTrack it: ${url}` : ""}\n` : ""}\n${linesText(p)}\n\n${BRAND.name}`,
    };
  }
  const amount = money(p.amountMinor, p.currency);
  const body = `We've refunded ${amount} for order ${p.orderNumber}${p.full ? "" : " (a partial refund)"}. It can take 5 to 10 working days to appear on your statement, depending on your bank.`;
  return {
    subject: `Refund of ${amount} for order ${p.orderNumber}`,
    html: layout("Your refund is on its way", `<p>${escape(hello)}</p><p>${escape(body)}</p>`),
    text: `${hello}\n\n${body}\n\n${BRAND.name}`,
  };
}
