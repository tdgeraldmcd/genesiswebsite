# Meta funnel tracking

Pixel: 1074670735061961 (reused from existing site).

Browser tracking is restricted to genesiscontent.io. All four funnel pages load
assets/funnel-tracking.js. It emits PageView and ViewContent; InitiateCheckout
fires when the embedded checkout mounts, a one-click purchase is accepted, or a
regular Stripe link is clicked. Purchases fire only from payment-confirmed code
paths. Amounts in USD: free 4.95, us 97, ds 47, accelerator first payment 97.

Purchase events receive random event IDs; the private funnel bearer is never
sent to Meta. Session storage and in-memory state suppress repeat reporting per
offer/order in the same tab, including reloads. This is browser tracking, not an
exactly-once revenue ledger. Ad blockers, navigation, cleared storage, or absent
browser callbacks can prevent delivery. Staging does not emit to the live pixel.

Outstanding:
- Verify receipt in Meta Events Manager Test Events; no account access verified.
- Audit the separate GTM container for duplicate Meta tags before ad optimization.
- Add Conversions API from signed Stripe webhooks for hosted Payment Link
  purchases, browser-independent purchase delivery, and monthly renewals. Requires
  a Meta access token in the Worker secret vault and shared event IDs for browser/
  server deduplication; do not simply send a second Purchase event.
- Booking Schedule should fire on confirmed appointment, not a booking-link click.
  The external booking integration is not yet configured here.
