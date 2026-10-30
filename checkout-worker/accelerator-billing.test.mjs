import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { limitAcceleratorBilling, twelveMonthEnd } from './accelerator-billing.mjs';
import worker from './worker.mjs';

const env = { ACCELERATOR_PAYMENT_LINK_ID: 'plink_accelerator', ACCELERATOR_PRICE_ID: 'price_accelerator', ACCELERATOR_STRIPE_KEY: 'rk_test_mock' };
const session = { payment_link: 'plink_accelerator', mode: 'subscription', payment_status: 'paid', subscription: 'sub_mock' };
const anchor = Date.UTC(2030, 0, 31, 12, 30) / 1000;
const sub = () => ({ status: 'active', billing_cycle_anchor: anchor, start_date: anchor,
  items: { data: [{ quantity: 1, price: { id: 'price_accelerator', unit_amount: 9700, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] } });

test('12-period cutoff includes the initial payment and handles leap days', () => {
  assert.equal(twelveMonthEnd(anchor), Date.UTC(2031, 0, 31, 12, 30) / 1000);
  assert.equal(twelveMonthEnd(Date.UTC(2032, 1, 29, 8) / 1000), Date.UTC(2033, 1, 28, 8) / 1000);
  assert.throws(() => twelveMonthEnd(NaN));
});

test('unrelated links and unpaid checkouts cannot change billing', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected API call'); });
  assert.equal(await limitAcceleratorBilling({ ...session, payment_link: 'plink_other' }, env), false);
  assert.equal(await limitAcceleratorBilling({ ...session, payment_status: 'unpaid' }, env), true);
  assert.equal(await limitAcceleratorBilling(session, {}), false);
});

test('sets exact cutoff without prorations; repeats do not extend or rewrite it', async t => {
  let subscription = sub();
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/subscriptions/sub_mock');
    if (options.method === 'POST') {
      writes++;
      assert.equal(options.headers['Idempotency-Key'], 'accelerator-12-periods-v1-sub_mock');
      assert.equal(options.body.get('proration_behavior'), 'none');
      subscription.cancel_at = Number(options.body.get('cancel_at'));
    }
    return Response.json(subscription);
  });
  await limitAcceleratorBilling(session, env);
  await limitAcceleratorBilling(session, env);
  assert.equal(writes, 1);
  assert.equal(subscription.cancel_at, Date.UTC(2031, 0, 31, 12, 30) / 1000);
});

test('preserves earlier cancellation and never revives canceled subscriptions', async t => {
  for (const change of [{ cancel_at: anchor + 100 }, { cancel_at_period_end: true }, { status: 'canceled' }]) {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.method, 'GET');
      return Response.json({ ...sub(), ...change });
    });
    assert.equal(await limitAcceleratorBilling(session, env), true);
    t.mock.restoreAll();
  }
});

test('unexpected terms fail for review rather than modifying another contract', async t => {
  for (const change of [{ trial_end: anchor + 100 }, { schedule: 'sub_sched_other' }, { billing_cycle_anchor: anchor + 100 },
    { items: { data: [{ quantity: 1, price: { id: 'price_other' } }] } }]) {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.method, 'GET');
      return Response.json({ ...sub(), ...change });
    });
    await assert.rejects(limitAcceleratorBilling(session, env), /manual review/);
    t.mock.restoreAll();
  }
});

async function signedEvent(type, config) {
  const raw = JSON.stringify({ type, data: { object: session } });
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'test_secret').update(`${timestamp}.${raw}`).digest('hex');
  return worker.fetch(new Request('https://checkout.example/webhook', { method: 'POST',
    headers: { 'Stripe-Signature': `t=${timestamp},v1=${sig}` }, body: raw }),
  { ...env, STRIPE_WEBHOOK_SECRET: 'test_secret', ORDERS: { put: async () => assert.fail('Not a Compass order') }, ...config });
}

test('signed webhook retries on Stripe failure without exposing secrets', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private error rk_test_mock', { status: 403 }));
  const result = await signedEvent('checkout.session.completed');
  assert.equal(result.status, 500);
  assert.doesNotMatch(await result.text(), /rk_test|private error/);
});

test('both immediate and delayed successful payments get the limit', async t => {
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST') { writes++; return Response.json({ ...sub(), cancel_at: twelveMonthEnd(anchor) }); }
    return Response.json(sub());
  });
  assert.equal((await signedEvent('checkout.session.completed')).status, 200);
  assert.equal((await signedEvent('checkout.session.async_payment_succeeded')).status, 200);
  assert.equal(writes, 2);
});
