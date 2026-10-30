# One-click upsell status — 2026-10-30

Production one-click backend is enabled as version
`c40e5d5a-5fa4-4cdf-88c9-bf1981656be6`. The user saved the live restricted
`ONE_CLICK_STRIPE_KEY` in the production Worker secrets vault. A no-payment
smoke check returned HTTP 200 and a live Checkout Session, confirming key mode,
initial price read, customer creation, and Checkout Session creation permissions.
No live purchase was made.

Frontend activation committed and pushed as `41dc94a`, with a new configuration
asset version on all four funnel pages. Production webhook
`we_1UVJZjCW5UYfW04oU7Flz2K1` includes all one-click reconciliation events.

## Staging

- URL: https://genesis-one-click-staging.xecvtive.workers.dev/free/
- Worker version: e2b26814-7a6d-4a12-ae44-ffb20aeaa233
- Uses the existing account's shared Test mode, explicitly authorized by the user.
- Secret `ONE_CLICK_STRIPE_KEY` saved by the user and verified by creating a test
  Checkout Session; `STRIPE_WEBHOOK_SECRET` saved via Wrangler. No keys in source.
- Four test price IDs and test publishable key configured in the staging config.
- Webhook: we_1UWLXnCW5UYfW04oZqNPVAqD, API 2026-09-30.endive, all events in
  `funnel-events.mjs` plus the three Checkout completion/failure events.
- Separate KV: 45d0c93ead7f461780ecde0dce4cec43.
- Build with `node checkout-worker/build-one-click-staging.mjs`; deploy with
  `wrangler deploy --config checkout-worker/wrangler.one-click-staging.jsonc`.
- The test harness uses the actual frontend scripts and backend, with minimal
  test-only layouts and the production `/free` CSP. It is not a full visual clone.

## Verified with Stripe test payments

1. Initial $4.95 ordinary Checkout saved a test card with explicit consent,
   confirmed payment server-side, and redirected to `/us`.
2. $97 webinar acceptance charged the saved card and redirected to `/accelerator/`
   without asking for card details again.
3. $97/month subscription acceptance charged the saved card, activated the
   subscription, and redirected to the configured interview-booking page.
4. Another initial checkout rejected an insufficient-funds test card without
   advancing. Retrying with an always-authenticate card opened Stripe's 3DS test
   challenge; completing it succeeded and redirected to `/us`.
5. Skipping `/us` reached `/ds`; $47 acceptance reused the saved card, completed
   the required bank challenge, and redirected to `/accelerator/`.
6. Accelerator also completed bank authentication and reached booking.
7. Revisiting the purchased downsell recovered its completed status. Stripe
   still showed exactly three successful PaymentIntents for that test customer:
   495, 4700, and 9700 cents. No duplicate purchase was created.
8. Both initial paid-order keys and payment/subscription webhook reconciliation
   records were present in staging KV.
9. Final card-only saved-payment Checkout configuration was accepted by Stripe
   (`allowed_payment_method_types: ['card']`), and its form rendered in the in-app
   browser with the production CSP. Other methods retain the regular-checkout
   path on the real site. Chrome's embedded frame remained blank during the
   automated check; the pre-existing test checkout also rendered a blank frame
   in the same Chrome profile. Console logs showed extension-style listener
   errors. This suggests a browser/profile issue, but the cause is unconfirmed
   and a clean Chrome rendering check remains outstanding.
10. All 38 local mocked backend/browser tests pass.
11. The test clock advanced beyond the cancellation boundary. Stripe reports
    the subscription canceled at 1824924955, exactly 12 paid invoices at 9700
    cents each, total 116400 cents ($1,164), and no thirteenth invoice.

## Evidence

Normal-card initial session:
`cs_test_a1Ehbwk5bGL7jAUZsNY9VtkVqrrVwit4W2DFz8nNZJ0PgkLcBdv4vF62fn`
Customer: `cus_VXQQBA9GghI3Zl`
Accelerator: `sub_1UWLahCW5UYfW04oKyntPFtm`
Billing anchor: 1793388955; cancel_at: 1824924955 (twelve months).
Test clock attached to this customer: `clock_1UWLcuCW5UYfW04oKiijpejS`.

Decline / bank-authentication / downsell session:
`cs_test_a18LbBnknqH15LXpMKqzpvQEJzt3oppdlPd8IpxcHkpnxVwaOR99ankAdA`
Customer: `cus_VXQSW769m2kZNm`
Initial PI: `pi_3UWLbuCW5UYfW04o11I6UrAI`
Downsell PI: `pi_3UWLddCW5UYfW04o1ERl8Qzg`
Accelerator PI: `pi_3UWLeFCW5UYfW04o1kExHh4v`

## Verification limits

- Full payment and 12-installment behavior verified in Stripe test mode, not by
  charging a live card. Live write permissions beyond checkout creation rely on
  the user configuring the same permissions as the tested key.
- GitHub Pages build for 41dc94a completed. All four published pages reference
  the activated configuration; the public config returns oneClick: true.
- Production /free consent and the $4.95 Stripe card form rendered successfully
  in the in-app browser. No card details were entered and Pay was not clicked.
  The earlier Chrome-profile rendering issue remains unconfirmed.
- Delivery remains explicitly outside this task. Test booking redirects were
  checked without submitting or booking an appointment.
