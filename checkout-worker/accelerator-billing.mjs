// Only applies to the explicitly configured accelerator Payment Link.
// Stripe owns collection and retries; this caps the contract at 12 billing periods.
export function twelveMonthEnd(anchor) {
  const date = new Date(anchor * 1000);
  if (!Number.isSafeInteger(anchor) || !Number.isFinite(date.getTime())) throw new Error('Invalid billing anchor');
  const year = date.getUTCFullYear() + 1;
  const month = date.getUTCMonth();
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()) / 1000;
}

export async function limitAcceleratorBilling(session, env) {
  if (!env.ACCELERATOR_PAYMENT_LINK_ID || session.payment_link !== env.ACCELERATOR_PAYMENT_LINK_ID) return false;
  if (session.mode !== 'subscription' || !['paid', 'no_payment_required'].includes(session.payment_status)) return true;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId || '') || !env.ACCELERATOR_PRICE_ID || !env.ACCELERATOR_STRIPE_KEY) {
    throw new Error('Accelerator billing is not configured');
  }
  async function stripe(body) {
    const response = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${env.ACCELERATOR_STRIPE_KEY}`,
        'Stripe-Version': '2026-09-30.endive',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `accelerator-12-periods-v1-${subscriptionId}` } : {})
      },
      body, signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Accelerator billing update failed');
    return response.json();
  }
  const subscription = await stripe();
  if (['canceled', 'incomplete_expired'].includes(subscription.status)) return true;
  const items = subscription.items?.data;
  const item = items?.[0];
  const price = item?.price;
  if (items?.length !== 1 || subscription.items.has_more || item.quantity !== 1 ||
      price?.id !== env.ACCELERATOR_PRICE_ID || price.unit_amount !== 9700 || price.currency !== 'usd' ||
      price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 ||
      subscription.trial_start || subscription.trial_end || subscription.schedule || subscription.pause_collection ||
      subscription.billing_cycle_anchor !== subscription.start_date) {
    throw new Error('Accelerator subscription needs manual review');
  }
  // Anchor to the first paid billing period, never webhook delivery/retry time.
  const end = twelveMonthEnd(subscription.billing_cycle_anchor);
  // Preserve an existing earlier cancellation, including a customer's cancellation.
  if (subscription.cancel_at_period_end || (subscription.cancel_at && subscription.cancel_at <= end)) return true;
  if (end <= Math.floor(Date.now() / 1000)) throw new Error('Accelerator billing limit is overdue');
  const updated = await stripe(new URLSearchParams({ cancel_at: String(end), proration_behavior: 'none' }));
  if (updated.cancel_at !== end) throw new Error('Accelerator billing limit was not confirmed');
  return true;
}
