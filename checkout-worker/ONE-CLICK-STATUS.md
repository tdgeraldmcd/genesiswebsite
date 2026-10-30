# One-click upsell staging status

As of 2026-10-30, the new integration is implemented locally and disabled in
`free/checkout-config.js` and both Worker configs. Production has not been cut
over. Existing live Checkout and Payment Links remain the purchase flow.

The separate `genesis-one-click-staging` Worker was deployed successfully,
version `5e76257c-dbce-4092-b0f0-60fb80b2391f`. Its Stripe mode is test, its
one-click flag is false, and its price/publishable-key variables are placeholders.
No sandbox payment has been executed. The connector sandbox authorization failed
for the user, and the CLI automatic sandbox provisioning did not yield usable
credentials. Do not treat either attempt as a connected sandbox.

## Implemented

- Ordinary $4.95 embedded Checkout with explicit saved-payment consent.
- Browser-bound, expiring purchase session; server-controlled prices.
- Explicit $97 or $47 webinar acceptance, mutually exclusive within the session.
- Explicit $97/month accelerator acceptance with a twelve-month cancellation cap.
- Idempotency, serialized requests, bank authentication handling, and payment
  status recovery without silently starting another checkout.
- Signed webhook reconciliation and blocking further upsells after risk events.
- Regular Checkout links for visitors without a saved purchase session.

## Validation and remaining work

`npm test --prefix checkout-worker` passes all 38 mocked backend/browser tests.
Cloudflare dry-run bundling succeeds. These checks do not establish that the
Stripe integration works end to end.

Before activation, configure sandbox credentials and all four sandbox prices;
register the webhook events in `funnel-events.mjs` alongside the existing Checkout
events; test the initial checkout, both webinar routes, accelerator billing,
authentication, declines, duplicate/retried requests, webhooks, and the complete
twelve-period subscription lifecycle. Verify the real browser UI and CSP.

The staging Worker requires `ONE_CLICK_STRIPE_KEY` as a secret, a sandbox
`STRIPE_PUBLISHABLE_KEY`, price IDs, and `STRIPE_WEBHOOK_SECRET`. Never commit
credentials. Use sandbox keys only on staging. Production needs a separately
scoped live key and verified live price IDs before enabling the flags and
deploying. Delivery remains outside this task.
