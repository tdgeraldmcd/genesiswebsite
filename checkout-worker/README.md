# Content Compass embedded checkout

## Current deployment

- Worker: https://genesis-content-checkout.xecvtive.workers.dev
- Cloudflare account: d790632d189381078ab7fadb118d0fe8
- Order storage: `ORDERS`, KV namespace `genesis-checkout-orders` (`d2f38fd5872f49c894af9b8f7f4e49a0`).
- Rate limiter: `CHECKOUT_LIMITER`, namespace 495, ten session attempts per IP per 60 seconds (Cloudflare's per-location enforcement).
- Code and bindings have been deployed through the Cloudflare dashboard.
- Live price `price_1UVInACW5UYfW04o5cFsr4YI`, publishable key, and website origin are saved in Cloudflare. The live restricted key is stored as encrypted `STRIPE_SECRET_KEY`; its permissions are Prices Read and Checkout Sessions Write. The webhook signing secret is stored as encrypted `STRIPE_WEBHOOK_SECRET`. Stripe destination `we_1UVJZjCW5UYfW04oU7Flz2K1` is active for the three checkout events below, with snapshot API version `2026-09-30.endive`. Website activation was published through GitHub commit `cd85da23ddd66448307742f7e45f152b8b4af0c2`; live form rendering and the USD 4.95 total were verified. Cache refresh followed in commit `8f2ce75f1859de2d19dd2bd632380275ba771051`.

## Integration testing and maintenance

1. Use a separate Stripe sandbox to test this new integration. Configure matching `STRIPE_SECRET_KEY` (prefer a minimally scoped restricted key), `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_PRICE_ID`. Store credentials only as encrypted Cloudflare secrets. The configured price must be an active one-time USD 4.95 price.
2. The active destination points to `https://genesis-content-checkout.xecvtive.workers.dev/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`. Store its signing secret as `STRIPE_WEBHOOK_SECRET`.
3. Test the deployed backend and page against Stripe sandbox, including success, decline, 3DS, redirects, delayed methods, backend failure, and duplicate events. Configure `SITE_ORIGIN` to the exact test website origin. Use separate sandbox storage to keep test orders separate from production.
4. Production uses `SITE_ORIGIN=https://genesiscontent.io` and the public Worker URL in `free/checkout-config.js`. Do not make a live purchase for testing.

The browser integration uses Stripe's embedded Checkout. The Worker pins Stripe API version `2026-08-26.dahlia`, enables dynamic payment methods, owns pricing server-side, verifies webhook signatures, and records paid orders by session ID. Webhooks must be registered before enabling the integration. Recorded orders are marked `fulfillment: pending`; no email delivery is implemented.

## Funnel redirects — enabled 2026-10-30

The embedded $4.95 checkout redirects to `/us` only after `/status` confirms
payment. The $4.95 fallback Payment Link also redirects to `/us/`.
The $97 webinar and $47 downsell Payment Links redirect to `/accelerator/`.
The $97/month accelerator Payment Link redirects to
`https://app.iclosed.io/e/gns/thoughtleader`.
Decline navigation is unchanged: `/us` → `/ds` → `/accelerator` → booking.
These are normal separate Stripe checkouts, not one-click saved-card upsells.
Payment Link redirect settings were saved and verified via Stripe. Embedded
redirect checks verified that paid responses navigate and unpaid responses do
not. No live purchase was made; email delivery and enrollment remain unimplemented.

## Verification

Run `node --test checkout-worker/worker.test.mjs` from the repository root. Ten mocked backend tests cover origin restrictions, credentials, server-controlled pricing, wrong-price rejection, payment status, error redaction, webhook signatures, duplicate order writes, and throttling. These are not real Stripe integration tests.

A real live-mode session-creation smoke test returned HTTP 200 through Cloudflare’s HTTP test console on 2026-10-27. No live payment was made. Stripe test-mode end-to-end completion, decline, retry with 3DS, return-page confirmation, webhook delivery, and separate KV order persistence passed on 2026-10-27. See TEST-RESULTS.md for evidence and scope. Local Git HEAD remains at 3772f02 because this session cannot write .git; the frontend commit was made through GitHub’s browser UI. Reconcile remote main before the next local commit.

## Accelerator billing cap — deployed 2026-10-30

Cloudflare version `bc5bb9f6-683e-4b6b-ae4f-03b9dc3d65fb` enables the cap for:

- Payment Link: `plink_1UWKY9CW5UYfW04obQbXLD2p`
- Monthly price: `price_1UVrWQCW5UYfW04oh2v25Mnh` ($97 USD)
- Credential: encrypted `ACCELERATOR_STRIPE_KEY` (not in source).

`accelerator-billing.mjs` handles signed checkout completion and delayed-success
webhooks for this exact link. It sets Stripe's `cancel_at` to the end of twelve
monthly billing periods, including the first checkout payment, with
`proration_behavior=none`. Stripe owns invoicing and failed-payment retries.
The contract is not extended to collect twelve successful payments after missed
invoices. Earlier cancellations are preserved; duplicate events cannot extend
billing. Unexpected price, trial, schedule, or billing-anchor changes fail for
manual review rather than rewriting another contract. Stripe retries webhook
failures; check the destination's failed deliveries in Stripe when investigating.

Verification: all 17 local mocked tests passed. The live credential successfully
read subscriptions and passed a write-permission probe against a deliberately
nonexistent subscription (HTTP 404 resource_missing, no customer changes). The
signed checkout event destination is enabled. Cloudflare confirmed the deployed
version and both accelerator configuration bindings. Temporary diagnostic code
was removed. No accelerator subscribers existed at the predeployment check.

Limitations: no real purchase or sandbox test-clock simulation of all twelve
billing periods was performed. Tax settings and fulfillment are unchanged. This
is a billing-cap addition, not a complete accelerator enrollment integration.

Tests: `node --test checkout-worker/worker.test.mjs checkout-worker/accelerator-billing.test.mjs`
