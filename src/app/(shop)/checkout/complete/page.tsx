import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle, Clock, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { CommerceError } from "@/lib/commerce/errors";
import { confirmPaymentByReference } from "@/lib/commerce/payments";
import { ClearBag } from "@/components/shop/clear-bag";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment status", robots: { index: false } };

type Tone = "good" | "wait" | "problem";
const MESSAGES: Record<string, { title: string; body: string; tone: Tone }> = {
  CONFIRMED: { title: "Payment confirmed", body: "Thank you. Your order is confirmed. Keep your order number for any questions about delivery.", tone: "good" },
  PENDING_PAYMENT: { title: "Still confirming your payment", body: "This can take a few minutes. Refresh this page shortly; you will not be charged twice.", tone: "wait" },
  PAYMENT_REVIEW: { title: "Your payment needs a quick review", body: "We received a payment that we need to check by hand. Our team will contact you.", tone: "problem" },
  REFUND_PENDING: { title: "We could not complete this order", body: "Your payment was received but the items are no longer available. A full refund has been started.", tone: "problem" },
  CANCELLED: { title: "This checkout expired", body: "No payment was confirmed before the checkout expired. If you were charged, it will be refunded automatically.", tone: "problem" },
};

/** Paystack redirects here with ?reference=. The browser redirect itself is never trusted; the page verifies server-side. */
export default async function CheckoutCompletePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const reference = typeof params.reference === "string" && /^DFP_[a-f0-9]{32}$/.test(params.reference) ? params.reference : null;

  let view: { title: string; body: string; tone: Tone } = { title: "We could not find this payment", body: "Check the link in your confirmation email, or contact us with your order number.", tone: "problem" };
  let orderNumber: string | null = null;
  if (reference) {
    try {
      const status = await confirmPaymentByReference(reference);
      orderNumber = status.orderNumber;
      const paid = ["CONFIRMED", "PROCESSING", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED"].includes(status.orderStatus);
      view = paid ? MESSAGES.CONFIRMED : MESSAGES[status.orderStatus] ?? { title: "Order received", body: "We are processing your order.", tone: "wait" };
    } catch (error) {
      if (!(error instanceof CommerceError)) view = { title: "We could not confirm your payment right now", body: "Your payment is safe. Refresh this page in a minute; we also confirm payments automatically.", tone: "wait" };
    }
  }
  const Icon = view.tone === "good" ? CheckCircle : view.tone === "wait" ? Clock : WarningCircle;

  return (
    <section className="mx-auto grid min-h-[60dvh] max-w-xl place-items-center px-4 py-16 text-center">
      <div>
        {view.tone === "good" && <ClearBag />}
        <Icon size={56} weight="duotone" className={`mx-auto ${view.tone === "good" ? "text-leaf" : view.tone === "wait" ? "text-ink-soft" : "text-danger"}`} aria-hidden="true" />
        <h1 className="mt-6 font-display text-4xl font-bold tracking-tight">{view.title}</h1>
        {orderNumber && <p className="mt-3 font-semibold tabular-nums">Order {orderNumber}</p>}
        <p className="mt-3 leading-relaxed text-ink-soft">{view.body}</p>
        <Link href="/shop" className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-6 font-semibold text-primary-ink hover:bg-primary-hover">Back to the shop</Link>
      </div>
    </section>
  );
}
