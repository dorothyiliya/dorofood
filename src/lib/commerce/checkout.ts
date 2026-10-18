import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Order, PaymentTransaction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCheckoutEnabled, ConfigError, getAppBaseUrl } from "@/lib/env";
import { getSettings, type Settings } from "@/lib/settings";
import { InsufficientStockError, reserveInventory } from "@/lib/inventory";
import { jsonSafe, lockOrder, recordAudit } from "@/lib/audit";
import { CommerceError, isUniqueViolation } from "@/lib/commerce/errors";
import { cartItemsSchema, countryCodeSchema, marketCodeSchema, priceCart } from "@/lib/commerce/pricing";
import { getGateway } from "@/lib/payments/gateway";
import { expireStaleOrders } from "@/lib/commerce/jobs";
import { ProviderRejectedError } from "@/lib/payments/types";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const phoneSchema = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number.");

export const checkoutSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  phone: phoneSchema.optional(),
  market: marketCodeSchema,
  shippingAddress: z.object({
    recipient: z.string().trim().min(2).max(120),
    phone: phoneSchema,
    line1: z.string().trim().min(3).max(200),
    line2: optionalText(200),
    city: z.string().trim().min(2).max(100),
    region: optionalText(100),
    postalCode: optionalText(20),
    countryCode: countryCodeSchema,
  }),
  items: cartItemsSchema,
  customerNote: optionalText(500),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,100}$/;
/** An INITIATED attempt younger than this may still be talking to Paystack. */
const INITIALISATION_LEASE_MS = 30_000;

function newOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `DF-${date}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

export function newPaymentReference() {
  return `DFP_${randomBytes(16).toString("hex")}`;
}

function requestHash(input: CheckoutInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export type CheckoutResult = {
  orderNumber: string;
  status: Order["status"];
  currency: string;
  subtotalMinor: string;
  shippingMinor: string;
  totalMinor: string;
  paymentExpiresAt: string;
  payment: { reference: string; authorizationUrl: string } | null;
};

function toResult(order: Order, payment: PaymentTransaction | null): CheckoutResult {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor.toString(),
    shippingMinor: order.shippingMinor.toString(),
    totalMinor: order.totalMinor.toString(),
    paymentExpiresAt: order.paymentExpiresAt.toISOString(),
    payment: payment?.authorizationUrl ? { reference: payment.providerReference, authorizationUrl: payment.authorizationUrl } : null,
  };
}

/**
 * Creates (or, for a repeated Idempotency-Key, returns) a pending order with
 * reserved stock and a Paystack payment session. Safe to retry: a lost response
 * never creates a second order or a second reservation.
 */
export async function createCheckout(rawInput: unknown, idempotencyKey: string | null): Promise<CheckoutResult> {
  assertCheckoutEnabled();
  const settings = await getSettings();
  if (!settings["checkout.open"]) throw new CommerceError("CHECKOUT_CLOSED", 503, "The store is not taking orders right now.");
  if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new CommerceError("IDEMPOTENCY_KEY_REQUIRED", 400, "Send a unique Idempotency-Key header (16-100 letters, digits, _ or -).");
  }
  const parsed = checkoutSchema.safeParse(rawInput);
  if (!parsed.success) throw new CommerceError("INVALID_CHECKOUT", 400, "Check the highlighted details.", z.flattenError(parsed.error));
  const input = parsed.data;
  const hash = requestHash(input);

  // Fail closed before reserving stock: the market's payment gateway must be ready.
  const marketRow = await prisma.market.findUnique({ where: { code: input.market } });
  if (marketRow) await getGateway(marketRow.paymentProvider, "new");

  let order = await prisma.order.findUnique({ where: { checkoutIdempotencyKey: idempotencyKey } });
  if (!order) {
    try {
      order = await createPendingOrder(input, idempotencyKey, hash, settings);
    } catch (error) {
      if (!isUniqueViolation(error, "checkoutIdempotencyKey")) throw error;
      order = await prisma.order.findUniqueOrThrow({ where: { checkoutIdempotencyKey: idempotencyKey } });
    }
  }
  if (order.checkoutRequestHash !== hash) {
    throw new CommerceError("IDEMPOTENCY_KEY_REUSED", 409, "This Idempotency-Key was already used for a different checkout.");
  }
  return ensurePaymentSession(order.id, input.email);
}

async function createPendingOrder(input: CheckoutInput, idempotencyKey: string, hash: string, settings: Settings): Promise<Order> {
  let freedExpired = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const priced = await priceCart(tx, { marketCode: input.market, countryCode: input.shippingAddress.countryCode, items: input.items });
        const location = await tx.inventoryLocation.findUnique({ where: { code: settings["fulfilment.locationCode"] } });
        if (!location?.active) throw new CommerceError("FULFILMENT_UNAVAILABLE", 503, "We cannot fulfil orders right now.");

        const paymentExpiresAt = new Date(Date.now() + settings["checkout.paymentWindowMinutes"] * 60_000);
        const order = await tx.order.create({
          data: {
            orderNumber: newOrderNumber(),
            marketId: priced.market.id,
            email: input.email,
            phone: input.phone,
            currency: priced.currency,
            subtotalMinor: priced.subtotalMinor,
            shippingMinor: priced.shippingMinor,
            totalMinor: priced.totalMinor,
            shippingAddressJson: jsonSafe(input.shippingAddress),
            customerNote: input.customerNote,
            destinationCountry: priced.destinationCountry,
            requiresExport: priced.requiresExport,
            paymentExpiresAt,
            checkoutIdempotencyKey: idempotencyKey,
            checkoutRequestHash: hash,
            items: {
              create: priced.lines.map((line) => ({
                variantId: line.variantId,
                productNameSnapshot: line.productName,
                skuSnapshot: line.sku,
                packSizeSnapshot: line.packSize,
                quantity: line.quantity,
                unitPriceMinor: line.unitPriceMinor,
                lineTotalMinor: line.lineTotalMinor,
              })),
            },
          },
        });

        // Lines are sorted by variant id so concurrent checkouts lock balances in the same order (no deadlocks).
        for (const line of priced.lines) {
          try {
            await reserveInventory(tx, { variantId: line.variantId, locationId: location.id, quantity: line.quantity, orderId: order.id, expiresAt: paymentExpiresAt });
          } catch (error) {
            if (error instanceof InsufficientStockError) {
              throw new CommerceError("OUT_OF_STOCK", 409, "Some items are no longer available in the quantity requested.", { variantId: error.variantId });
            }
            throw error;
          }
        }

        if (priced.requiresExport) {
          await tx.exportRecord.create({
            data: {
              orderId: order.id,
              destinationCountry: priced.destinationCountry,
              status: "PENDING_REVIEW",
              productEligibilityJson: jsonSafe(priced.lines.map((l) => ({ variantId: l.variantId, sku: l.sku, exportEligible: l.exportEligible, origin: l.originCountry }))),
            },
          });
        }
        await recordAudit(tx, { action: "ORDER_CREATED", entityType: "Order", entityId: order.id, metadata: { totalMinor: priced.totalMinor, currency: priced.currency, destination: priced.destinationCountry } });
        return order;
      }, { maxWait: 20_000, timeout: 20_000 });
    } catch (error) {
      if (attempt < 3 && isUniqueViolation(error, "orderNumber")) continue;
      // The scheduled job may run rarely (daily on Vercel Hobby), so abandoned checkouts can
      // still hold stock after their window closed: release those now and retry once.
      if (!freedExpired && error instanceof CommerceError && error.code === "OUT_OF_STOCK") {
        freedExpired = true;
        const { expired } = await expireStaleOrders({ limit: 20 }).catch(() => ({ expired: 0 }));
        if (expired > 0) continue;
      }
      throw error;
    }
  }
}

/**
 * Returns the current payment session, or starts a new attempt with a fresh
 * reference. A fresh reference per attempt means a lost Paystack response can
 * be retried without hitting Paystack's duplicate-reference rejection; any
 * second successful charge for the same order is refunded automatically.
 */
async function ensurePaymentSession(orderId: string, email: string): Promise<CheckoutResult> {
  const claim = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { market: true } });
    const payments = await tx.paymentTransaction.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });
    if (order.status !== "PENDING_PAYMENT") return { order, payment: payments[0] ?? null, start: false };
    if (order.paymentExpiresAt.getTime() <= Date.now()) {
      throw new CommerceError("PAYMENT_WINDOW_EXPIRED", 410, "This checkout has expired. Please start again.");
    }
    const open = payments.find((p) => p.status === "PENDING" && p.authorizationUrl);
    if (open) return { order, payment: open, start: false };
    const inFlight = payments.find((p) => p.status === "INITIATED" && Date.now() - p.createdAt.getTime() < INITIALISATION_LEASE_MS);
    if (inFlight) throw new CommerceError("PAYMENT_INITIALISATION_IN_PROGRESS", 409, "Your payment is being prepared. Please retry in a few seconds.");
    const payment = await tx.paymentTransaction.create({
      data: {
        orderId,
        provider: order.market.paymentProvider,
        providerReference: newPaymentReference(),
        idempotencyKey: `order:${orderId}:attempt:${payments.length + 1}`,
        currency: order.currency,
        amountMinor: order.totalMinor,
      },
    });
    return { order, payment, start: true };
  });

  if (!claim.start || !claim.payment) return toResult(claim.order, claim.payment);

  const payment = claim.payment;
  try {
    const gateway = await getGateway(payment.provider, "new");
    const session = await gateway.initialize({
      email,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      reference: payment.providerReference,
      callbackUrl: `${getAppBaseUrl()}/checkout/complete`,
      orderNumber: claim.order.orderNumber,
    });
    const updated = await prisma.paymentTransaction.update({
      where: { id: payment.id },
      data: { status: "PENDING", authorizationUrl: session.authorizationUrl, ...(session.session ? { metadataJson: jsonSafe(session.session) } : {}) },
    });
    return toResult(claim.order, updated);
  } catch (error) {
    if (error instanceof ConfigError) {
      await prisma.paymentTransaction.updateMany({ where: { id: payment.id, status: "INITIATED" }, data: { status: "FAILED", failureReason: `gateway not configured: ${error.code}` } });
      throw error;
    }
    if (error instanceof ProviderRejectedError) {
      await prisma.paymentTransaction.updateMany({
        where: { id: payment.id, status: "INITIATED" },
        data: { status: "FAILED", failureReason: `initialize rejected: ${error.message}`.slice(0, 500) },
      });
      throw new CommerceError("PAYMENT_PROVIDER_REJECTED", 502, "The payment provider could not start this payment.");
    }
    // Outcome unknown: leave the attempt INITIATED for reconciliation; a retry
    // with the same Idempotency-Key starts a new attempt after the lease expires.
    console.error("[checkout] payment initialisation outcome unknown", { reference: payment.providerReference, error: (error as Error).message });
    throw new CommerceError("PAYMENT_PROVIDER_UNAVAILABLE", 502, "We could not reach the payment provider. Retry with the same Idempotency-Key.");
  }
}
