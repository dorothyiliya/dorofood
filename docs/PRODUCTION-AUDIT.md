# Production-readiness audit

Date: 2026-10-15. Scope: the whole repository as found, then the fixes made in response.

**Verdict: not production-ready.** The payment, inventory and refund core is now built and tested against a real PostgreSQL database and a mocked Paystack. But there is no customer checkout form and no staff authentication or admin surface. Paystack is untested against its real sandbox, no carrier is integrated, and the business, legal and tax prerequisites are not in place. The open items are listed under "Still open" below.

## What was found

The repository was a storefront mock-up with a database schema and a few server skeletons. Its own checks did not pass:

| Check | As found |
| --- | --- |
| `prisma generate` / `migrate` / seed | Failed: invalid schema (`Product.marketProducts` had no opposite relation) |
| `npm run typecheck` | Failed (consequence of the schema error) |
| `npm run lint` | Did not run: no ESLint config; deprecated `next lint` stopped at an interactive prompt |
| Unit / integration / e2e tests | None existed |
| `npm run build` | Not reached |

The critical customer journey stopped at the basket. "Continue to checkout" only showed a toast. No order, reservation or payment could be created, and payment verification was a stub that threw.

## Prioritised defects

Status: **Fixed** means fixed and covered by an automated test or check listed below. **Open** means not fixed here.

### P0: money, stock and data integrity

| # | Defect | Status |
| --- | --- | --- |
| 1 | Prisma schema invalid; no migrations existed | **Fixed.** Schema corrected; initial migration created |
| 2 | No order, checkout or payment lifecycle | **Fixed server-side**: `POST /api/v1/checkout`, disabled unless `CHECKOUT_ENABLED=true`. **Open:** storefront checkout form (see 21) |
| 3 | Paystack webhook returned 2xx for signed events without storing or processing them. Payments would be silently lost and Paystack would not retry | **Fixed.** Events are persisted before any 2xx. A processing failure returns non-2xx so Paystack redelivers, and the reconciliation job retries stored failures |
| 4 | No duplicate or replay protection for webhooks (Paystack signatures carry no timestamp) | **Fixed.** Payloads are deduplicated on a unique hash, and every state transition is idempotent under row locks |
| 5 | No server-side payment verification and no amount or currency check | **Fixed.** Only the Paystack Verify API decides success. The webhook body and browser redirect are never trusted. A wrong amount or currency sends the order to `PAYMENT_REVIEW` |
| 6 | Reservations were never committed, released or expired, and were not linked to orders: stock would leak | **Fixed.** Full lifecycle (ACTIVE → COMMITTED → FULFILLED, or RELEASED/EXPIRED) with conditional transitions. The expiry job checks with Paystack before releasing stock |
| 7 | Nothing in the database prevented negative stock, over-reservation or negative or zero money | **Fixed.** CHECK constraints in the migration. Tests confirm the database rejects violations even when application code is bypassed |
| 8 | No handling for late payment after expiry, double charges, refunds or failed shipment creation | **Fixed.** See the scenario table |
| 9 | International: the UI let UK/US/CA shoppers add Nigeria-only products, and nothing server-side checked eligibility | **Fixed.** The server checks eligibility per market, product and destination at quote and checkout. Export orders need export-review approval before they can ship, and a rejection refunds automatically. The UI blocks ineligible products |
| 10 | Seed overwrote on-hand stock on every run (would corrupt live reservations) and matched only 5 of the 8 catalogue products | **Fixed.** Stock is set only on creation, a RECEIPT movement is recorded, all 8 products match, and the seed refuses to run in production |

### P1: security, trust and misleading behaviour

| # | Defect | Status |
| --- | --- | --- |
| 11 | No staff authentication or role checks. No admin surface exists for refunds, export review, shipment creation or dispatch | **Open (launch blocker).** These operations exist only as server functions with **no HTTP route**, deliberately, so nothing unauthenticated is exposed |
| 12 | No rate limiting. Anyone can hold stock for 30 minutes per unpaid checkout, which allows inventory-hoarding abuse, and can hammer verify, quote and checkout | **Open (launch blocker).** Needs infrastructure (edge WAF or Redis limiter) plus per-email or per-IP caps on open checkouts |
| 13 | No security headers | **Fixed.** CSP (`frame-ancestors 'none'`, no external scripts), nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, and HSTS in production |
| 14 | Secret handling unverified; live keys could be used by accident | **Fixed and verified.** `server-only` guards on every server module. A build with canary secrets showed no secret names or values in client bundles. `sk_live_` keys are refused without `PAYSTACK_ALLOW_LIVE_KEYS=true` and are only ever sent to `api.paystack.co` |
| 15 | Fake data shown as real: "Bestseller", "Customer favourite", "Staff pick" and "New arrival" labels; a "delivered to your door" banner; the products API reported demo stock as `available` | **Fixed.** Labels removed, the banner now says "store preview, ordering not open", and `/api/v1/products` reads the database. **Open:** the storefront still renders the hard-coded preview catalogue, not the database |
| 16 | Newsletter form said "YOU'RE ON THE LIST" while storing nothing | **Fixed.** Form removed and replaced with "opens at launch" |
| 17 | Dead controls: Account, Explore food boxes, Policies and Checkout only showed toasts; the wishlist heart toggled a CSS class with no state | **Fixed.** Removed, or replaced with an honest disabled state |
| 18 | No shipping, returns, privacy or terms policies | **Open (legal launch blocker)** |
| 19 | Tax is always 0. Nigerian VAT and destination taxes or duties for exports are not modelled | **Open.** Business and tax decision needed |
| 20 | No `.gitignore` (`.env` would be committed); README referenced a missing `.env.example` | **Fixed** |

### P2: correctness and quality

| # | Defect | Status |
| --- | --- | --- |
| 21 | No customer checkout form, address capture or persistent basket. The basket is lost on reload, despite the README calling it a "local browser basket" | **Open.** The checkout API is ready for it |
| 22 | `GET /api/v1/products?limit=abc` returned an empty list (NaN) | **Fixed** |
| 23 | Two copies of the HMAC check | **Fixed** (one implementation) |
| 24 | Toast timers raced; the basket drawer had no Escape key or focus handling | **Fixed** |
| 25 | `npm audit`: 3 high-severity findings, all in build-time tooling (Next's bundled postcss, braces via Tailwind 3, deepmerge-ts via the Prisma CLI). The fixes need major upgrades (Next 16, Tailwind 4) | **Open, low runtime exposure** |
| 26 | Google Fonts loaded from Google's CDN, so visitor IPs go to Google (a UK GDPR consideration) | **Open, low.** Self-host via `next/font` |
| 27 | `mailto:hello@dorocityfoods.com` and marketing claims ("transparent pricing and delivery information before you place an order") are unverified | **Open.** Confirm the mailbox and copy |

## Critical scenarios and how they are now handled

All of these are automated tests in `test/integration/` running against PostgreSQL 16 and an in-process fake Paystack. The app's real HTTP client talks to the fake over a socket.

| Scenario | Behaviour | Test |
| --- | --- | --- |
| 25 concurrent checkouts for 5 units | Exactly 5 orders; 20 get `OUT_OF_STOCK`; the losers leave no rows behind | inventory-concurrency |
| Multi-item orders contending in opposite orders | No deadlock, no oversell (locks always taken in variant-id order) | inventory-concurrency |
| Checkout response lost; client retries, including 6 simultaneous duplicates | `Idempotency-Key` returns the same order; one reservation; one Paystack transaction | inventory-concurrency |
| Paystack `initialize` succeeded but its response was lost | Order kept; the retry starts a fresh payment reference; no duplicate order | payments |
| Customer pays on both attempts | The second charge is refunded automatically (`DUPLICATE_PAYMENT`) | payments |
| Payment succeeded, webhook lost | The customer's return page verifies server-side; otherwise the reconciliation job confirms | payments |
| Duplicate or replayed webhooks (8 concurrent plus a replay) | Confirmed once; one event row; no refund | payments |
| Forged, unsigned, tampered or wrong-key webhooks | 401, no state change | payments |
| Signed `charge.success` for a transaction Paystack says is unpaid | Not confirmed (Verify API is the authority) | payments |
| Paystack Verify down when the webhook arrives | Event stored; 500 returned so Paystack redelivers; reconciliation recovers it | payments |
| Under-payment or wrong currency | Never confirmed; order goes to `PAYMENT_REVIEW` | payments |
| Unpaid order expires | Stock released, order cancelled, stock sellable again | payments |
| Paid in the last second before the expiry job | The job asks Paystack first, then confirms instead of cancelling | payments |
| Late payment after expiry, stock still free | Re-reserved and confirmed | payments |
| Late payment after expiry, stock sold to someone else | Not confirmed; full automatic refund; the other customer's stock untouched | payments |
| Expiry job racing the payment webhook (5 rounds) | One consistent outcome; stock invariant holds | payments |
| Concurrent partial refunds | Never exceed the amount paid | refunds-shipping |
| Refund API outcome unknown (lost response) | Marked `UNKNOWN` and **never auto-retried** (Paystack refunds have no idempotency key); matched later from the refund webhook | refunds-shipping |
| Refund rejected, or `refund.failed` | Recorded as FAILED; the amount becomes refundable again | refunds-shipping |
| Carrier fails during shipment creation | Order stays paid and undispatched with stock allocated; retry reuses the same idempotency key | refunds-shipping |
| No carrier configured | Fails closed; nothing created | refunds-shipping |
| Export order | Held for export review; rejection triggers a refund; approval allows shipping | refunds-shipping |
| Payment or cron credentials missing, or checkout disabled | Checkout 503, webhook 503 (Paystack retries), cron 503 or 401; no orders or reservations created | refunds-shipping, smoke |

Test strength was checked by injecting 11 deliberate bugs, one at a time. Examples: removing the stock guard, trusting the webhook body, skipping the amount check, accepting any signature, expiring without checking for payment. **All 11 were caught.**

## Verification run

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` (ESLint 9, `next/core-web-vitals` + `next/typescript`) | Pass, 0 warnings |
| `npm test` (unit) | 18 / 18 pass |
| `npm run test:integration` (PostgreSQL 16) | 40 / 40 pass |
| `npm run build` | Pass |
| `npm run test:smoke` (`next start` over HTTP, unconfigured and then configured with the fake Paystack) | 19 / 19 pass |
| Client-bundle secret scan (canary secrets set at build) | No secrets in `.next/static` |
| Browser check of the production build | Renders under the CSP with no console errors; the UK market blocks Nigeria-only products |

## Verified vs. untested vs. operational

**Verified here (automated):** everything in the two tables above, against a real database and mocked providers.

**Untested integrations (mocks only):**
- **Paystack sandbox.** The initialize, verify and refund request and response shapes follow Paystack's documentation but have not been run against `api.paystack.co` with an `sk_test_` key. Field names in refund webhook payloads are not confirmed by an official sample; the code accepts both `transaction_reference` and `transaction.reference`. The webhook path makes a synchronous Verify call; latency against Paystack's delivery timeout is unmeasured.
- **Carrier.** None is integrated. `CarrierAdapter` is an interface only, and `getConfiguredCarrier()` returns null, so shipment creation fails closed. A real adapter must forward the idempotency key to the carrier.
- **Email and SMS notifications.** None exist.

**Operational dependencies (must exist before launch):**
- Managed PostgreSQL with backups and tested restores. `prisma migrate deploy` must run as a controlled release step.
- A scheduler calling `GET /api/internal/jobs/reconcile` with `Authorization: Bearer $CRON_SECRET` every ~5 minutes. Without it, unpaid orders hold stock indefinitely and lost webhooks are never recovered.
- The Paystack dashboard webhook URL set to `/api/v1/webhooks/paystack`.
- Alerting and a staff view for: `PaymentEvent` FAILED, `Refund` UNKNOWN or FAILED, orders in `PAYMENT_REVIEW` or `REFUND_PENDING`, and `Shipment` FAILED. Today these are only visible by querying the database.
- A runbook for reconciling `UNKNOWN` refunds in the Paystack dashboard.
- A retention policy for `PaymentEvent.payloadJson`, which contains customer PII from Paystack.

## Known limitations of the new code

- Single fulfilment location (`FULFILMENT_LOCATION_CODE`); there is no multi-warehouse allocation.
- Shipping is a flat rate per market and country (`ShippingRule.flatRateMinor`). With no rate set, checkout refuses rather than inventing a price. The seeded Nigeria rule is disabled.
- Customers can see order status only through their payment reference (the return page). There are no accounts or order lookup.
- If a duplicate charge differs in amount from the order total, it is refunded at the received amount, but full-refund status tracking for that edge case is approximate.
