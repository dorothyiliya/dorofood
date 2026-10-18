export type VerifiedPayment = {
  /** Our own payment reference (DFP_…), the key every gateway reports back against. */
  reference: string;
  amountMinor: bigint;
  currency: string;
  /** Normalised outcome. Only "success" may ever confirm an order. */
  status: "success" | "failed" | "pending";
  rawStatus: string;
  providerTransactionId: string | null;
  paidAt: Date | null;
};

/**
 * The provider call could not be completed or returned something unexpected.
 * The outcome is unknown, so callers must not treat it as a failed payment.
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

/** The provider definitively rejected the request (for example, a bad refund amount). */
export class ProviderRejectedError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "ProviderRejectedError";
  }
}

/** What a gateway needs to know about a payment we already created. */
export type GatewayPayment = {
  providerReference: string;
  providerTransactionId: string | null;
  metadataJson: unknown;
  amountMinor: bigint;
  currency: string;
};

export function asGatewayPayment(p: GatewayPayment): GatewayPayment {
  return { providerReference: p.providerReference, providerTransactionId: p.providerTransactionId, metadataJson: p.metadataJson, amountMinor: p.amountMinor, currency: p.currency };
}
