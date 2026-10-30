import { stripeClient } from './one-click.mjs';
const idOf = value => typeof value === 'string' ? value : value?.id;
export const FUNNEL_EVENTS = [
  'payment_intent.succeeded', 'payment_intent.payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed', 'charge.refunded',
  'charge.dispute.created', 'radar.early_fraud_warning.created'
];
export async function processFunnelEvent(event, env) {
  if (env.ONE_CLICK_ENABLED !== 'true' || !FUNNEL_EVENTS.includes(event.type)) return false;
  const stripe = stripeClient(env);
  let resource = event.data.object;
  const risk = ['charge.refunded', 'charge.dispute.created', 'radar.early_fraud_warning.created'].includes(event.type);
  if (event.type.startsWith('invoice.')) {
    const subscription = idOf(resource.parent?.subscription_details?.subscription || resource.subscription);
    if (!subscription) return true;
    resource = await stripe.subscriptions.retrieve(subscription);
  } else if (risk) {
    const charge = event.type === 'charge.refunded' ? resource : await stripe.charges.retrieve(idOf(resource.charge));
    const paymentId = idOf(charge.payment_intent);
    if (!paymentId) return true;
    resource = await stripe.paymentIntents.retrieve(paymentId);
    // Some invoice-generated payments don't inherit subscription metadata.
    if (!resource.metadata?.genesis_funnel) {
      const payments = await stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:paymentId},limit:1});
      const invoiceId = idOf(payments.data[0]?.invoice);
      if (!invoiceId) return true;
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const subscription = idOf(invoice.parent?.subscription_details?.subscription || invoice.subscription);
      if (!subscription) return true;
      resource = await stripe.subscriptions.retrieve(subscription);
    }
  }
  const funnelId = resource.metadata?.genesis_funnel;
  if (!/^[a-f0-9]{64}$/.test(funnelId || '')) return true;
  // Durable event record for fulfillment/reconciliation; delivery remains separate.
  await env.ORDERS.put(`funnel-event:${event.id}`, JSON.stringify({eventId:event.id,type:event.type,
    objectId:event.data.object.id,funnelId,created:event.created,reviewRequired:risk || event.type.endsWith('payment_failed')}));
  if (risk && env.FUNNEL_SESSIONS) {
    const stub = env.FUNNEL_SESSIONS.get(env.FUNNEL_SESSIONS.idFromString(funnelId));
    const response = await stub.fetch(new Request('https://funnel.internal/event',{method:'POST',body:JSON.stringify({blocked:true})}));
    if (!response.ok) throw new Error('Funnel risk state update failed');
  }
  return true;
}
