import type { Metadata } from "next";
import Link from "next/link";
import { CommerceError } from "@/lib/commerce/errors";
import { confirmPaymentByReference } from "@/lib/commerce/payments";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment status — Dorocity Food", robots: { index: false } };

const MESSAGES: Record<string, { title: string; body: string }> = {
  CONFIRMED: { title: "Payment confirmed", body: "Thank you. Your order is confirmed. Keep your order number for any questions about delivery." },
  PENDING_PAYMENT: { title: "We are still confirming your payment", body: "This can take a few minutes. Refresh this page shortly; you will not be charged twice." },
  PAYMENT_REVIEW: { title: "Your payment needs a quick review", body: "We received a payment that we need to check by hand. Our team will contact you." },
  REFUND_PENDING: { title: "We could not complete this order", body: "Your payment was received but the items are no longer available. A full refund has been started." },
  CANCELLED: { title: "This checkout expired", body: "No payment was confirmed before the checkout expired. If you were charged, it will be refunded automatically." },
};

/** Paystack redirects here with ?reference=. The browser redirect itself is never trusted; the page verifies server-side. */
export default async function CheckoutCompletePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reference = typeof params.reference === "string" && /^DFP_[a-f0-9]{32}$/.test(params.reference) ? params.reference : null;

  let title = "We could not find this payment";
  let body = "Check the link in your confirmation email, or contact us with your order number.";
  let orderNumber: string | null = null;
  if (reference) {
    try {
      const status = await confirmPaymentByReference(reference);
      orderNumber = status.orderNumber;
      const known = ["PROCESSING", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED"].includes(status.orderStatus) ? MESSAGES.CONFIRMED : MESSAGES[status.orderStatus];
      ({ title, body } = known ?? { title: "Order received", body: "We are processing your order." });
    } catch (error) {
      if (!(error instanceof CommerceError)) {
        title = "We could not confirm your payment right now";
        body = "Your payment is safe. Refresh this page in a minute; we also confirm payments automatically.";
      }
    }
  }

  return (
    <main className="site-shell" style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: "48px 16px" }}>
      <section style={{ maxWidth: 520, textAlign: "center" }}>
        <h1 style={{ fontSize: 32, marginBottom: 12 }}>{title}</h1>
        {orderNumber && <p style={{ fontWeight: 700, marginBottom: 12 }}>Order {orderNumber}</p>}
        <p style={{ color: "#68736a", lineHeight: 1.7 }}>{body}</p>
        <p style={{ marginTop: 24 }}><Link className="button-primary" href="/">Back to the shop</Link></p>
      </section>
    </main>
  );
}
