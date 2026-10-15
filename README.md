# Dorocity Food

A premium, curated food ecommerce starter for Nigerian customers and eligible international export destinations.

## Status

**Not production-ready.** Read [docs/PRODUCTION-AUDIT.md](docs/PRODUCTION-AUDIT.md) first.

- The storefront is a **preview**: it renders a hard-coded sample catalogue, has no checkout form, and says so on the page.
- The server-side commerce core is built and tested against PostgreSQL with a mocked Paystack. It covers authoritative pricing, export eligibility, stock reservation, idempotent checkout, Paystack verification, a durable and deduplicated webhook, late-payment and duplicate-charge handling, refunds, shipment creation with retry, and dispatch.
- Checkout is **off** unless `CHECKOUT_ENABLED=true`, and every payment path fails closed without valid credentials.
- There is no staff authentication or admin UI, no rate limiting, no carrier integration, and no testing against the real Paystack sandbox.

## Storefront

Design language: the "forest" palette from the logo (deep forest `#123c2a`, forest `#06542a`, leaf `#66a218`, harvest gold `#e4ba0c`), Bricolage Grotesque for display and Geist for text (self-hosted with `next/font`), Phosphor icons, and light and dark themes from CSS tokens in `src/app/globals.css`.

| Page | What it does |
| --- | --- |
| `/` | Hero with a product shelf, how ordering works, shop by aisle, new arrivals, an aisle spotlight, delivery by destination (live from the database), brand story |
| `/shop` | Every product, with aisle filters, instant search and sort, kept in the URL |
| `/products/[slug]` | Product page with quantity, add to bag, delivery for the chosen destination, and related products |
| `/checkout` | Contact and address, a server-priced total, then payment on Paystack. Shows "opens soon" while checkout is off |
| `/checkout/complete` | Payment confirmed server-side; the bag is emptied only after confirmation |

The bag and the chosen destination are saved in the browser. Products show the first photo added in **Admin → Catalogue → Photos**, or an illustrated pack until a photo exists. The brand name lives in `src/lib/brand.ts`; the logo artwork reads "DotFoods" while the site uses "Dorocity Foods".

To click through checkout locally without Paystack, run the sandbox and point the app at it:

```bash
FAKE_PAYSTACK_SECRET=sk_test_local_anything npx tsx scripts/fake-paystack-server.ts
PAYSTACK_SECRET_KEY=sk_test_local_anything PAYSTACK_API_BASE_URL=http://127.0.0.1:4010 CHECKOUT_ENABLED=true npm run dev
```

## Admin control centre (`/admin`)

Staff sign in at `/admin/login`. Everything operational is controlled there:

| Area | What you can do |
| --- | --- |
| Dashboard | Paid revenue, orders awaiting payment or fulfilment, a "needs attention" queue (payment reviews, refunds with unknown outcome, failed webhooks or shipments, export reviews, unshipped orders), low stock |
| Orders | Search and filter; full detail with timeline; check payment with Paystack, cancel unpaid orders, accept or refund payment reviews, issue full or partial refunds, record refund outcomes, export approve or reject, create a shipment with carrier and tracking number, mark dispatched or delivered |
| Payments / Refunds | Every Paystack transaction and webhook event; retry failed events; refunds needing attention |
| Catalogue / Categories | Products, variants (SKUs), per-market prices, export eligibility, categories |
| Inventory | Stock by location, receipts, adjustments, stocktakes (never below reserved stock), movement history, locations |
| Markets & delivery | Markets and currencies; delivery rules with flat rates (no rate means no checkout) |
| Store settings | Store open or closed, payment window, fulfilment location, low-stock threshold, preview mode, announcement bar, contact email |
| Staff | Accounts and roles (Owner, Admin, Finance, Fulfilment, Catalogue, Viewer), password resets, deactivation |
| Audit log / System | Who changed what; configuration health; run reconciliation now |

Every action is re-checked on the server against the signed-in role and written to the audit log.

### Create the first owner

There is no default password and no public sign-up. From your terminal, against the database you want (`.env.local` is used if present):

```bash
npm run admin:create -- --email you@example.com --name "Your Name"
```

You are prompted for the password (hidden; 12+ characters). Further staff are added from **Staff** in the admin.

### When checkout is actually live

All three must be true, and **System** shows which is missing:
1. `CHECKOUT_ENABLED=true` on the deployment (Vercel: production and development yes, preview no).
2. A Paystack secret key in `PAYSTACK_SECRET_KEY`.
3. **Store settings → Store accepts orders** switched on.

The storefront has no checkout form yet, so even then customers can only order through the API.

## Requirements

- Node.js 20.9 or newer
- PostgreSQL 16 (Docker is used locally)
- npm

## Run locally

```bash
npm install
cp .env.example .env
npm run db:test:up            # PostgreSQL in Docker on 127.0.0.1:54329
docker exec dorocity-pg psql -U dorocity -c "CREATE DATABASE dorocity_test;"
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000. The homepage works without a database; the API routes need `DATABASE_URL`.

## Quality checks

```bash
npm run check                 # typecheck + lint + unit + integration tests + build
npm run test:smoke            # after a build: runs `next start` and walks the journey over HTTP
```

Integration and smoke tests truncate every table, so they only run against a database whose name ends in `_test` (`TEST_DATABASE_URL`).

## Architecture

- `src/app/api/v1/products`: catalogue from the database (price and availability per market)
- `src/app/api/v1/checkout/quotes`: price and eligibility check; reserves nothing
- `src/app/api/v1/checkout`: creates the order, reserves stock, starts the Paystack payment (needs an `Idempotency-Key` header)
- `src/app/api/v1/payments/verify` and `src/app/checkout/complete`: customer-facing payment status, verified server-to-server
- `src/app/api/v1/webhooks/paystack`: signed, persisted, deduplicated webhook
- `src/app/api/internal/jobs/reconcile`: scheduled job (Bearer `CRON_SECRET`) that retries failed events, verifies open payments, expires unpaid orders and sends pending refunds
- `src/lib/commerce/*`: pricing, checkout, payments, refunds, shipments, jobs. Refunds, export review, shipment creation and dispatch have **no HTTP route** until staff authentication exists
- `src/lib/inventory.ts`: reservation lifecycle; every transition is conditional, and the database enforces 0 ≤ reserved ≤ on hand
- `src/lib/env.ts`: server-only configuration that fails closed
- `test/`: unit tests, integration tests and a fake Paystack server

## Production launch checklist

1. Configure a managed PostgreSQL database and run migrations in a controlled release.
2. Replace demo catalogue data with reviewed product data and licensed product photography.
3. Implement real authentication, account recovery, session protection, and staff role enforcement.
4. Implement server-side cart persistence and a transactional checkout workflow.
5. Complete payment initiation, verification, webhook idempotency, reconciliation, refunds, and settlement reporting.
6. Integrate a shipping provider and validate real delivery coverage and quotes.
7. Implement product-by-destination export eligibility and the required export documentation workflow.
8. Add durable background jobs, monitoring, error reporting, backups, and restore tests.
9. Complete security, accessibility, load, and end-to-end tests.
10. Obtain required merchant and regulatory approvals before accepting orders.

## Deployment

Deploy the Next.js application to Vercel and configure environment variables in the project settings. Use separate databases and credentials for development, preview, and production. Run Prisma migrations as a controlled deployment step. Never commit `.env` files or expose secret keys through `NEXT_PUBLIC_` variables.
