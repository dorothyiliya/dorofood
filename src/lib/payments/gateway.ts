import "server-only";
import { ConfigError } from "@/lib/env";
import { PAYMENT_PROVIDERS, type PaymentProviderId } from "@/lib/integrations/definitions";
import { getIntegration } from "@/lib/integrations/store";
import { createPaystackRefund, getPaystackConfig, initializePaystackTransaction, verifyPaystackTransaction } from "@/lib/payments/paystack";
import { getWhopConfig, initializeWhopCheckout, refundWhopPayment, verifyWhopPayment } from "@/lib/payments/whop";
import type { GatewayPayment, VerifiedPayment } from "@/lib/payments/types";

/**
 * One interface over every payment provider. Checkout, refunds, webhooks and
 * reconciliation call this, so the safety rules (server-side verification,
 * idempotency, unknown-outcome handling) apply to every gateway identically.
 */
export interface PaymentGateway {
  id: PaymentProviderId;
  label: string;
  initialize(input: { reference: string; amountMinor: bigint; currency: string; email: string; callbackUrl: string; orderNumber: string }): Promise<{ authorizationUrl: string; session?: Record<string, string> }>;
  verify(payment: GatewayPayment): Promise<VerifiedPayment>;
  refund(input: { payment: GatewayPayment; amountMinor: bigint; note: string }): Promise<{ providerRef: string; status: string }>;
}

const paystack: PaymentGateway = {
  id: "paystack",
  label: "Paystack",
  initialize: (input) => initializePaystackTransaction({ ...input, metadata: { orderNumber: input.orderNumber } }),
  verify: (payment) => verifyPaystackTransaction(payment.providerReference),
  refund: ({ payment, amountMinor, note }) => createPaystackRefund({ reference: payment.providerReference, amountMinor, merchantNote: note }),
};

const whop: PaymentGateway = {
  id: "whop",
  label: "Whop",
  initialize: (input) => initializeWhopCheckout(input),
  verify: (payment) => verifyWhopPayment(payment),
  refund: ({ payment, amountMinor }) => refundWhopPayment({ payment, amountMinor }),
};

const GATEWAYS: Record<PaymentProviderId, PaymentGateway> = { paystack, whop };

export function isPaymentProvider(value: string): value is PaymentProviderId {
  return (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The gateway for a provider. `purpose: "new"` (starting a payment) also
 * requires the integration to be switched on; settling an existing payment
 * (verify, refund, webhooks) only needs working credentials.
 */
export async function getGateway(provider: string, purpose: "new" | "existing" = "existing"): Promise<PaymentGateway> {
  if (!isPaymentProvider(provider)) throw new ConfigError("PAYMENTS_MISCONFIGURED", `Unknown payment provider "${provider}".`);
  if (provider === "paystack") await getPaystackConfig(purpose);
  else await getWhopConfig(purpose);
  return GATEWAYS[provider];
}

/** Can this provider take new payments right now? Used for status displays; reveals no detail. */
export async function gatewayReady(provider: string) {
  if (!isPaymentProvider(provider)) return false;
  try {
    await getGateway(provider, "new");
    return (await getIntegration(provider)).active;
  } catch {
    return false;
  }
}
