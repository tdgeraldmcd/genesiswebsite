import Stripe from 'stripe';
import { twelveMonthEnd } from './accelerator-billing.mjs';

export const CONSENT_VERSION = '2026-10-30-v1';
const LIFETIME = 2 * 60 * 60;
const BOOKING = 'https://app.iclosed.io/e/gns/thoughtleader';
const idOf = value => typeof value === 'string' ? value : value?.id;
export class FunnelError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const stripeClient = env => {
  if (env.STRIPE_MODE === 'test' && !/^(sk|rk)_test_/.test(env.ONE_CLICK_STRIPE_KEY || '')) throw new Error('Sandbox requires a test key');
  if (env.STRIPE_MODE === 'live' && !/^(sk|rk)_live_/.test(env.ONE_CLICK_STRIPE_KEY || '')) throw new Error('Production requires a live key');
  return new Stripe(env.ONE_CLICK_STRIPE_KEY, {
  apiVersion: '2026-09-30.endive', httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 15000
});
};

// Serialised by one Durable Object per unguessable browser token. Stripe idempotency
// keys also protect against isolate restarts between an API response and storage.
export class Funnel {
  constructor(storage, stripe, env, id, now = () => Math.floor(Date.now() / 1000)) {
    Object.assign(this, { storage, stripe, env, id, now });
  }
  async save(record) { await this.storage.put('record', record); return record; }
  async record() {
    const record = await this.storage.get('record');
    if (!record || this.now() >= record.expires || record.blocked) throw new FunnelError('Your purchase session has expired. Use secure checkout to continue.', 401);
    return record;
  }
  async price(id, amount, recurring = false) {
    const price = await this.stripe.prices.retrieve(id);
    if (!price.active || price.unit_amount !== amount || price.currency !== 'usd' ||
      (recurring ? price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 : price.type !== 'one_time')) {
      throw new FunnelError('This offer is unavailable. Please contact us.', 503);
    }
  }
  options(operation) { return { idempotencyKey: `genesis-funnel-v1:${this.id}:${operation}` }; }
  async start(input) {
    if (input.consent !== true || input.consentVersion !== CONSENT_VERSION) throw new FunnelError('Please agree to save your payment method before continuing.');
    let record = await this.storage.get('record');
    if (!record) {
      record = await this.save({ created: this.now(), expires: this.now() + LIFETIME,
        consent: { version: CONSENT_VERSION, acceptedAt: this.now() }, operations: {} });
      await this.storage.setAlarm((record.expires + 86400) * 1000);
    }
    record = await this.record();
    await this.price(this.env.STRIPE_PRICE_ID, 495);
    if (!record.customer) {
      const customer = await this.stripe.customers.create({ metadata: { genesis_funnel: this.id } }, this.options('customer'));
      record.customer = customer.id; await this.save(record);
    }
    let session;
    if (record.session) session = await this.stripe.checkout.sessions.retrieve(record.session);
    else {
      session = await this.stripe.checkout.sessions.create({
        customer: record.customer, mode: 'payment', ui_mode: 'embedded_page',
        line_items: [{ price: this.env.STRIPE_PRICE_ID, quantity: 1 }],
        payment_intent_data: { setup_future_usage: 'off_session', metadata: { genesis_funnel: this.id, offer: 'content-compass' } },
        metadata: { genesis_funnel: this.id, offer: 'content-compass', consent_version: CONSENT_VERSION },
        integration_identifier: 'genesis_oneclick_qmzwbnyr',
        redirect_on_completion: 'if_required',
        expires_at: record.expires,
        return_url: `${this.env.SITE_ORIGIN}/free/?session_id={CHECKOUT_SESSION_ID}#order`,
        custom_text: { submit: { message: 'Your payment method will be saved for optional offers you explicitly accept next. No additional offer is purchased automatically.' } }
      }, this.options('checkout'));
      record.session = session.id; await this.save(record);
    }
    return { sessionId: session.id, clientSecret: session.client_secret, publishableKey: this.env.STRIPE_PUBLISHABLE_KEY };
  }
  async verified() {
    const record = await this.record();
    if (!record.session) throw new FunnelError('Complete the initial checkout first.', 403);
    const session = await this.stripe.checkout.sessions.retrieve(record.session, { expand: ['payment_intent.payment_method'] });
    if (session.status !== 'complete' || session.payment_status !== 'paid' || session.amount_total !== 495 ||
      session.currency !== 'usd' || idOf(session.customer) !== record.customer || session.metadata?.genesis_funnel !== this.id) {
      throw new FunnelError('Your initial payment is not confirmed yet. Please wait before continuing.', 409);
    }
    const payment = session.payment_intent;
    const method = payment?.payment_method;
    if (payment?.status !== 'succeeded' || method?.type !== 'card' || idOf(method.customer) !== record.customer ||
        payment.setup_future_usage !== 'off_session') {
      throw new FunnelError('This payment method cannot be reused here. Please use secure checkout.', 422);
    }
    record.method = method.id;
    record.card = { brand: method.card.brand, last4: method.card.last4 };
    await this.save(record);
    return record;
  }
  async summary() {
    const record = await this.verified();
    return { ready: true, card: record.card, publishableKey: this.env.STRIPE_PUBLISHABLE_KEY };
  }
  async purchase(input) {
    if (!['us', 'ds', 'accelerator'].includes(input.offer) || input.accepted !== true || input.consentVersion !== CONSENT_VERSION) {
      throw new FunnelError('Please accept a valid offer.');
    }
    const record = await this.verified();
    const slot = input.offer === 'accelerator' ? 'accelerator' : 'webinar';
    let operation = record.operations[slot];
    if (operation && operation.offer !== input.offer) throw new FunnelError('A different webinar purchase is already in progress or completed. Continue to the next offer.', 409);
    if (!operation) {
      operation = { offer: input.offer, acceptedAt: this.now(), consentVersion: CONSENT_VERSION };
      record.operations[slot] = operation;
      await this.save(record); // Lock the choice durably before any payment API request.
    }
    if (slot === 'webinar') {
      const amount = operation.offer === 'us' ? 9700 : 4700;
      const price = operation.offer === 'us' ? this.env.UPSELL_PRICE_ID : this.env.DOWNSELL_PRICE_ID;
      await this.price(price, amount);
      let payment;
      if (operation.id) payment = await this.stripe.paymentIntents.retrieve(operation.id);
      else {
        // Create, persist, then confirm. A decline never loses the PaymentIntent ID.
        payment = await this.stripe.paymentIntents.create({ amount, currency: 'usd', customer: record.customer,
          payment_method: record.method, automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          metadata: { genesis_funnel: this.id, offer: operation.offer, price_id: price, consent_version: CONSENT_VERSION },
          description: operation.offer === 'us' ? 'Cash Flow Content Webinar with Q&A' : 'Cash Flow Content Webinar without Q&A'
        }, this.options('webinar-create'));
        operation.id = payment.id; await this.save(record);
      }
      if (payment.status === 'requires_confirmation') {
        try { payment = await this.stripe.paymentIntents.confirm(payment.id, {}, this.options('webinar-confirm')); }
        catch (error) { if (!error.payment_intent) throw error; payment = await this.stripe.paymentIntents.retrieve(payment.id); }
      }
      return this.paymentResult(payment, '/accelerator/');
    }
    await this.price(this.env.ACCELERATOR_PRICE_ID, 9700, true);
    let subscription;
    if (operation.id) subscription = await this.stripe.subscriptions.retrieve(operation.id, { expand: ['latest_invoice.confirmation_secret'] });
    else {
      subscription = await this.stripe.subscriptions.create({
        customer: record.customer, default_payment_method: record.method,
        items: [{ price: this.env.ACCELERATOR_PRICE_ID, quantity: 1 }],
        payment_behavior: 'default_incomplete', billing_mode: { type: 'flexible' },
        payment_settings: { save_default_payment_method: 'on_subscription' },
        // A cap exists from creation, even if a later request fails. Align precisely below.
        cancel_at: twelveMonthEnd(operation.acceptedAt), proration_behavior: 'none',
        metadata: { genesis_funnel: this.id, offer: 'accelerator', consent_version: CONSENT_VERSION },
        expand: ['latest_invoice.confirmation_secret']
      }, this.options('accelerator-create'));
      operation.id = subscription.id; await this.save(record);
    }
    if (['canceled', 'incomplete_expired'].includes(subscription.status)) return { status: 'failed', message: 'This subscription was not completed. Please contact us before trying again.' };
    const end = twelveMonthEnd(subscription.billing_cycle_anchor);
    if (!operation.capAligned && subscription.status === 'active' && subscription.latest_invoice?.status === 'paid') {
      // Never override an existing earlier customer cancellation on subsequent visits.
      subscription = await this.stripe.subscriptions.update(subscription.id, { cancel_at: end, proration_behavior: 'none',
        expand: ['latest_invoice.confirmation_secret'] }, this.options('accelerator-cap'));
      if (subscription.cancel_at !== end) throw new Error('Billing cap not confirmed');
      operation.capAligned = true; await this.save(record);
    }
    const invoice = subscription.latest_invoice;
    if (operation.capAligned && subscription.status === 'active' && invoice?.status === 'paid') return { status: 'succeeded', next: BOOKING };
    const secret = invoice?.confirmation_secret?.client_secret;
    if (secret) return { status: 'requires_action', clientSecret: secret, publishableKey: this.env.STRIPE_PUBLISHABLE_KEY };
    return { status: 'processing', message: 'Your subscription payment is processing. Check its status before trying again.' };
  }
  paymentResult(payment, next) {
    if (payment.status === 'succeeded') return { status: 'succeeded', next };
    if (payment.status === 'requires_action') return { status: 'requires_action', clientSecret: payment.client_secret, publishableKey: this.env.STRIPE_PUBLISHABLE_KEY };
    if (payment.status === 'processing') return { status: 'processing', message: 'Your payment is processing. Check its status before trying again.' };
    return { status: 'failed', message: 'Your saved payment method could not complete this purchase. Please contact us before making another purchase.' };
  }
  async status(input) {
    const record = await this.record();
    const slot = input.offer === 'accelerator' ? 'accelerator' : 'webinar';
    const operation = record.operations[slot];
    if (!operation?.id || operation.offer !== input.offer) return { status: 'not_started' };
    // Reading status must never initiate or confirm another purchase.
    if (slot === 'webinar') return this.paymentResult(await this.stripe.paymentIntents.retrieve(operation.id), '/accelerator/');
    let subscription = await this.stripe.subscriptions.retrieve(operation.id, { expand: ['latest_invoice.confirmation_secret'] });
    if (!operation.capAligned && subscription.status === 'active' && subscription.latest_invoice?.status === 'paid') {
      const end = twelveMonthEnd(subscription.billing_cycle_anchor);
      subscription = await this.stripe.subscriptions.update(subscription.id, { cancel_at: end, proration_behavior: 'none', expand: ['latest_invoice.confirmation_secret'] }, this.options('accelerator-cap'));
      if (subscription.cancel_at !== end) throw new Error('Billing cap not confirmed');
      operation.capAligned = true; await this.save(record);
    }
    if (operation.capAligned && subscription.status === 'active' && subscription.latest_invoice?.status === 'paid') return { status: 'succeeded', next: BOOKING };
    return { status: 'processing', message: 'Your subscription is not yet confirmed. Please contact us if this persists.' };
  }
}

export class FunnelSession {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.queue = Promise.resolve(); }
  fetch(request) {
    const task = this.queue.then(async () => {
      try {
        const input = await request.json();
        const funnel = new Funnel(this.ctx.storage, stripeClient(this.env), this.env, this.ctx.id.toString());
        const action = new URL(request.url).pathname.split('/').pop();
        if (action === 'event') {
          const record = await this.ctx.storage.get('record');
          if (record && input.blocked) { record.blocked = true; await this.ctx.storage.put('record', record); }
          return Response.json({received:true});
        }
        if (!['start', 'summary', 'purchase', 'status'].includes(action)) throw new FunnelError('Not found', 404);
        return Response.json(await funnel[action](input));
      } catch (error) {
        return Response.json({ error: error instanceof FunnelError ? error.message : 'Payment could not be confirmed. Check the purchase status before retrying.' }, { status: error instanceof FunnelError ? error.status : 502 });
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

export async function funnelRoute(request, env) {
  if (!['/funnel/start','/funnel/summary','/funnel/purchase','/funnel/status'].includes(new URL(request.url).pathname)) return new Response('Not found',{status:404});
  if (env.ONE_CLICK_ENABLED !== 'true' || !env.FUNNEL_SESSIONS || !env.ONE_CLICK_STRIPE_KEY) return Response.json({ error: 'One-click checkout is not enabled.' }, { status: 503 });
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return Response.json({ error: 'A valid purchase session is required.' }, { status: 401 });
  if (Number(request.headers.get('Content-Length') || 0) > 4096) return new Response('Payload too large', { status: 413 });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const id = env.FUNNEL_SESSIONS.idFromName(hash);
  return env.FUNNEL_SESSIONS.get(id).fetch(request);
}
