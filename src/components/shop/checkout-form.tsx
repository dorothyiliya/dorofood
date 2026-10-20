"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Lock, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { formatMoney } from "@/lib/money";
import { ProductArt } from "@/components/shop/product-art";
import { useShop } from "@/components/shop/shop-provider";

type Quote = { subtotalMinor: string; shippingMinor: string; totalMinor: string; currency: string };
type Problem = { code: string; message: string };

const MESSAGES: Record<string, string> = {
  OUT_OF_STOCK: "Some items sold out while you were shopping. Please adjust your bag.",
  NOT_ELIGIBLE_FOR_DESTINATION: "Some items cannot be shipped to this destination. Remove them to continue.",
  SHIPPING_UNAVAILABLE: "We do not deliver to this destination yet.",
  MARKET_UNAVAILABLE: "We are not taking orders for this destination yet.",
  CHECKOUT_CLOSED: "The shop is not taking orders right now.",
  PAYMENT_PROVIDER_UNAVAILABLE: "We could not reach our payment provider. Nothing was charged; please try again.",
  INVALID_CHECKOUT: "Please check the highlighted details.",
};

function newKey() {
  return `web_${crypto.randomUUID().replace(/-/g, "")}`;
}

const field = "h-12 w-full rounded-xl border border-line bg-surface px-4 text-[15px] text-ink placeholder:text-ink-faint focus:border-leaf focus:outline-none focus:ring-4 focus:ring-leaf/15";

function Field({ label, name, error, children }: { label: string; name: string; error?: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-ink">{label}</label>
      {children}
      {error && <p className="text-sm text-danger" id={`${name}-error`}>{error}</p>}
    </div>
  );
}

export function CheckoutForm() {
  const { lines, market, checkoutLive, canShip } = useShop();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // One key per checkout attempt: a retried submit can never create a second order.
  const [key, setKey] = useState("");
  useEffect(() => setKey(newKey()), []);

  const items = useMemo(() => lines.map((l) => ({ variantId: l.product.id, quantity: l.quantity })), [lines]);
  const blocked = lines.some((l) => !canShip(l.product));

  useEffect(() => {
    if (!checkoutLive || items.length === 0 || blocked) return;
    let cancelled = false;
    fetch("/api/v1/checkout/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market: market.code, countryCode: market.countryCode, items }) })
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (ok) { setQuote(body); setProblem(null); } else { setQuote(null); setProblem({ code: body.code, message: MESSAGES[body.code] ?? body.error }); }
      })
      .catch(() => !cancelled && setProblem({ code: "NETWORK", message: "We could not load delivery prices. Check your connection." }));
    return () => { cancelled = true; };
  }, [checkoutLive, items, market.code, market.countryCode, blocked]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const get = (n: string) => String(form.get(n) ?? "").trim();
    setSubmitting(true);
    setProblem(null);
    setFieldErrors({});
    try {
      const response = await fetch("/api/v1/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          email: get("email"),
          phone: get("phone") || undefined,
          market: market.code,
          shippingAddress: { recipient: get("recipient"), phone: get("phone"), line1: get("line1"), line2: get("line2") || undefined, city: get("city"), region: get("region") || undefined, postalCode: get("postalCode") || undefined, countryCode: market.countryCode },
          items,
          customerNote: get("note") || undefined,
        }),
      });
      const body = await response.json();
      if (response.ok && body.payment?.authorizationUrl) {
        window.location.assign(body.payment.authorizationUrl);
        return;
      }
      if (body.code === "INVALID_CHECKOUT" && body.details?.fieldErrors) {
        const errors: Record<string, string> = {};
        for (const [k, v] of Object.entries(body.details.fieldErrors as Record<string, string[]>)) errors[k] = v[0];
        setFieldErrors(errors);
      }
      // A changed basket needs a new key; the server rejects key reuse with a different basket.
      if (["OUT_OF_STOCK", "NOT_ELIGIBLE_FOR_DESTINATION", "IDEMPOTENCY_KEY_REUSED"].includes(body.code)) setKey(newKey());
      setProblem({ code: body.code, message: MESSAGES[body.code] ?? body.error ?? "Something went wrong." });
    } catch {
      setProblem({ code: "NETWORK", message: "Connection lost. Your order was not placed twice; please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-24 text-center">
        <h1 className="font-display text-4xl font-bold">Your bag is empty</h1>
        <p className="mt-3 text-ink-soft">Add something good first, then come back here.</p>
        <Link href="/shop" className="mt-8 inline-flex h-12 items-center rounded-full bg-primary px-6 font-semibold text-primary-ink hover:bg-primary-hover">Browse groceries</Link>
      </div>
    );
  }

  const summary = (
    <aside className="rounded-card border border-line bg-surface p-6 lg:sticky lg:top-40 lg:self-start">
      <h2 className="font-display text-xl font-semibold">Order summary</h2>
      <ul className="mt-5 space-y-4">
        {lines.map(({ product, quantity }) => (
          <li key={product.id} className="flex items-center gap-3">
            <div className="h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-sunken"><ProductArt product={product} size="thumb" /></div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{product.name}</p>
              <p className="text-ink-faint">{product.size} · Qty {quantity}</p>
            </div>
          </li>
        ))}
      </ul>
      <dl className="mt-6 space-y-2 border-t border-line pt-5 text-sm">
        <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd className="tabular-nums">{quote ? formatMoney(quote.subtotalMinor, quote.currency) : "…"}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-soft">Delivery to {market.name}</dt><dd className="tabular-nums">{quote ? formatMoney(quote.shippingMinor, quote.currency) : "…"}</dd></div>
        <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{quote ? formatMoney(quote.totalMinor, quote.currency) : "…"}</dd></div>
      </dl>
      <p className="mt-4 text-xs text-ink-soft">Prices are confirmed by our server. You pay on our payment provider&apos;s secure page.</p>
    </aside>
  );

  if (!checkoutLive) {
    return (
      <div className="grid gap-10 py-10 lg:grid-cols-[1fr_400px]">
        <div className="rounded-card bg-sunken p-8">
          <h1 className="font-display text-4xl font-bold">Checkout opens soon</h1>
          <p className="mt-3 max-w-[52ch] text-ink-soft">We are not taking online orders yet. Your bag is saved on this device, so everything will still be here when we open.</p>
          <Link href="/shop" className="mt-6 inline-flex h-12 items-center rounded-full bg-primary px-6 font-semibold text-primary-ink hover:bg-primary-hover">Keep browsing</Link>
        </div>
        <aside className="rounded-card border border-line bg-surface p-6">
          <h2 className="font-display text-xl font-semibold">In your bag</h2>
          <ul className="mt-4 space-y-2 text-sm">{lines.map((l) => <li key={l.product.id} className="flex justify-between gap-3"><span className="truncate">{l.product.name}</span><span className="text-ink-soft">x{l.quantity}</span></li>)}</ul>
        </aside>
      </div>
    );
  }

  return (
    <div className="grid gap-10 py-10 lg:grid-cols-[1fr_400px] lg:gap-14">
      <form onSubmit={submit} className="space-y-10">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Checkout</h1>
          <p className="mt-2 text-ink-soft">Delivering to {market.name}. Change it from the bar at the top of the page.</p>
        </div>
        {(problem || blocked) && (
          <div role="alert" className="flex gap-3 rounded-xl bg-gold-soft px-4 py-3 text-sm text-gold-ink">
            <WarningCircle size={20} weight="fill" className="shrink-0" aria-hidden="true" />
            <p>{blocked ? `Some items in your bag are not sold in ${market.name}. Remove them to continue.` : problem!.message}</p>
          </div>
        )}
        <fieldset className="space-y-4">
          <legend className="mb-2 font-display text-xl font-semibold">Contact</legend>
          <Field label="Email" name="email" error={fieldErrors.email}><input id="email" name="email" type="email" required autoComplete="email" className={field} /></Field>
          <Field label="Phone" name="phone"><input id="phone" name="phone" type="tel" required autoComplete="tel" placeholder="+234" className={field} /></Field>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="mb-2 font-display text-xl font-semibold">Delivery address</legend>
          <Field label="Full name" name="recipient"><input id="recipient" name="recipient" required autoComplete="name" className={field} /></Field>
          <Field label="Address" name="line1"><input id="line1" name="line1" required autoComplete="address-line1" className={field} /></Field>
          <Field label="Apartment, landmark (optional)" name="line2"><input id="line2" name="line2" autoComplete="address-line2" className={field} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" name="city"><input id="city" name="city" required autoComplete="address-level2" className={field} /></Field>
            <Field label="State or region" name="region"><input id="region" name="region" autoComplete="address-level1" className={field} /></Field>
            <Field label="Postal code (optional)" name="postalCode"><input id="postalCode" name="postalCode" autoComplete="postal-code" className={field} /></Field>
          </div>
          <Field label="Delivery note (optional)" name="note"><textarea id="note" name="note" rows={3} maxLength={500} className={`${field} h-auto py-3`} /></Field>
        </fieldset>
        <button type="submit" disabled={submitting || !quote || blocked || !key}
          className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-lg font-semibold text-primary-ink transition hover:bg-primary-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
          <Lock size={20} weight="bold" aria-hidden="true" />
          {submitting ? "Connecting to secure payment…" : quote ? `Pay ${formatMoney(quote.totalMinor, quote.currency)}` : "Pay securely"}
        </button>
      </form>
      {summary}
    </div>
  );
}
