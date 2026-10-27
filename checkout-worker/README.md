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

## Funnel decision

The user plans an upsell at `/us` and explicitly deferred funnel mapping. Leave `successPath` empty until `/us` exists; then set it to `/us`. Do not automatically send purchasers directly to interview booking. Guide delivery and automated fulfillment remain pending the user's funnel decisions. Successful payment currently shows a confirmation message.

## Verification

Run `node --test checkout-worker/worker.test.mjs` from the repository root. Ten mocked backend tests cover origin restrictions, credentials, server-controlled pricing, wrong-price rejection, payment status, error redaction, webhook signatures, duplicate order writes, and throttling. These are not real Stripe integration tests.

A real live-mode session-creation smoke test returned HTTP 200 through Cloudflare’s HTTP test console on 2026-10-27. No live payment was made. Real sandbox payment completion, decline, and 3DS tests remain unperformed. Local Git HEAD remains at 3772f02 because this session cannot write .git; the frontend commit was made through GitHub’s browser UI. Reconcile remote main before the next local commit.
