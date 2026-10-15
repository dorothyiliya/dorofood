# Implementation status

See [PRODUCTION-AUDIT.md](PRODUCTION-AUDIT.md) for the full audit, the defect list and the verification evidence.

## Built and tested (PostgreSQL + mocked Paystack)
- Database catalogue API, server-side pricing, per-destination export eligibility
- Idempotent checkout with stock reservation (disabled unless `CHECKOUT_ENABLED=true`)
- Paystack initialize and verify; durable, deduplicated, signature-checked webhook
- Payment confirmation under row locks: duplicates, late payments, double charges, amount mismatches
- Reservation expiry with a check against Paystack first; reconciliation job
- Refunds (partial and full, concurrency-safe, unknown outcomes never auto-retried)
- Export review gate, shipment creation with retry, dispatch with stock movement
- Database CHECK constraints on stock and money

- Admin control centre (`/admin`): staff auth with roles, dashboard, orders, payments, refunds, catalogue, inventory, markets and delivery, store settings, staff, audit log, system status
- Storefront reads products, categories and settings from the database

## Not built
- Storefront checkout form and persistent basket
- Customer accounts; two-factor authentication and SSO for staff
- Rate limiting
- Carrier integration (shipment creation fails closed)
- Email and SMS notifications
- Tax, promotions and discounts
- Policies (shipping, returns, privacy, terms)
- Monitoring, alerting and backup or restore drills

## Do not
- Set `CHECKOUT_ENABLED=true` for real customers before the launch blockers in the audit are closed.
- Treat the preview catalogue or seed stock as real inventory.
- Mark an order paid based on a browser redirect or a webhook body; only `applyVerifiedPayment` after a Verify API call may do so.
- Retry a refund in `UNKNOWN` state automatically; reconcile it in the Paystack dashboard.
- Commit `.env` or provider secrets.
