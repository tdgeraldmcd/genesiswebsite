# Embedded checkout test results — 2026-10-27

No real card details or real charges were used. Production configuration was unchanged.

## Environment

- Test page: https://genesis-content-checkout-test.xecvtive.workers.dev/free/
- Same backend logic (`worker.mjs`) and browser checkout script (`free/embedded-checkout.js`) as production, served by a minimal test harness rather than the full sales-page layout.
- Stripe test mode in account acct_1H7ApzCW5UYfW04o; product prod_VWMYoUYyhU5EFY; price price_1UVJp8CW5UYfW04oJHWi2UXH, USD 4.95 one-time.
- Test-only restricted key: Prices Read and Checkout Sessions Write; encrypted in Cloudflare. Wrapper refuses non-test keys.
- Test webhook we_1UVJryCW5UYfW04oMdiNgncQ; encrypted signing secret; checkout completion and async payment success/failure events.
- Separate KV genesis-checkout-test-orders, ID 69f65dc6a39947a9a0ef9e95b36cd097, bound as ORDERS.
- Test harness build: node checkout-worker/build-test-worker.mjs. Deployed test Worker version prefix 6ad60330. This version fixes UTF-8 headers in the test harness; payment logic unchanged.

## Observed results

| Scenario | Result |
| --- | --- |
| Test-mode and price check | Stripe returned livemode:false, currency usd, totalAmount 495 |
| Successful test card | Payment confirmed in embedded frontend |
| Completed-session return URL | Confirmation restored by server-side status check |
| Declined test card | Inline credit-card-declined message; checkout remained available for retry |
| Retry with 3D Secure card | Stripe test authentication challenge appeared; COMPLETE led to payment confirmation |
| Webhook delivery | Both completion events returned by Stripe success filter with pending_webhooks:0 |
| Order persistence | Two separate paid session records present in test KV, with test emails and fulfillment:pending |

First success session: cs_test_a14yBCmPgh6QXpV817wTiuoarV2TFL87RCZFvJWWZfo5xWx03OSCmS9pfB
Completion event: evt_1UVJvlCW5UYfW04o5SmoHdSQ

Decline then 3DS success session: cs_test_a1xiZAoaCc0cl5HY5IRVCcHwD7foJkbNnSoqkPDyDMCHOjhFEHCMU796ps
Completion event: evt_1UVJxqCW5UYfW04ogxdWZAOt
PaymentIntent shown during challenge: pi_3UVJwsCW5UYfW04o0crYJ5xG

Test card scenarios followed https://docs.stripe.com/testing. Test identities used example.com emails.

## Scope and remaining work

Card success, decline, authentication, retry, frontend confirmation, return URL, real test webhooks, and storage were exercised. Wallets and delayed-payment methods were not exercised end to end. Duplicate-event behavior is covered by existing mocked backend tests, not a Dashboard resend in this run. The test harness does not mirror the production rate limiter or full sales-page layout.

Guide/email fulfillment and /us are not implemented, per the deferred funnel decision. Orders intentionally remain fulfillment:pending. Successful payments currently show confirmation. No claim of automatic content delivery or an upsell redirect is made.
