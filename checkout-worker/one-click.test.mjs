import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Funnel, FunnelSession, funnelRoute, CONSENT_VERSION } from './one-click.mjs';
const now = 1906545600;
const env = {SITE_ORIGIN:'https://example.com',STRIPE_PRICE_ID:'price_initial',UPSELL_PRICE_ID:'price_us',DOWNSELL_PRICE_ID:'price_ds',ACCELERATOR_PRICE_ID:'price_acc',STRIPE_PUBLISHABLE_KEY:'pk_test_example'};
function fixture() {
 const values = new Map(); const calls = [];
 const storage = {get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),setAlarm:async()=>{}};
 let payment = {id:'pi_upsell',status:'requires_confirmation',client_secret:'pi_upsell_secret_mock'};
 let subscription;
 const session = {id:'cs_test_initial',status:'complete',payment_status:'paid',amount_total:495,currency:'usd',customer:'cus_mock',metadata:{genesis_funnel:'funnelid'},client_secret:'cs_secret',payment_intent:{status:'succeeded',setup_future_usage:'off_session',payment_method:{id:'pm_mock',type:'card',customer:'cus_mock',card:{brand:'visa',last4:'4242'}}}};
 const stripe = {
  prices:{retrieve:async id=>({active:true,currency:'usd',id,unit_amount:id==='price_initial'?495:id==='price_ds'?4700:9700,type:id==='price_acc'?'recurring':'one_time',recurring:id==='price_acc'?{interval:'month',interval_count:1}:null})},
  customers:{create:async(p,o)=>{calls.push(['customer',p,o]);return {id:'cus_mock'}}},
  checkout:{sessions:{create:async(p,o)=>{calls.push(['checkout',p,o]);return session},retrieve:async()=>session}},
  paymentIntents:{create:async(p,o)=>{calls.push(['create',p,o]);return payment},retrieve:async()=>payment,confirm:async(id,p,o)=>{calls.push(['confirm',id,o]);payment.status='succeeded';return payment}},
  subscriptions:{create:async(p,o)=>{calls.push(['subscription',p,o]);subscription={id:'sub_mock',status:'active',billing_cycle_anchor:now,cancel_at:p.cancel_at,latest_invoice:{status:'paid'}};return subscription},retrieve:async()=>subscription,
   update:async(id,p,o)=>{calls.push(['cap',p,o]);subscription.cancel_at=p.cancel_at;return subscription}}
 };
 const funnel = new Funnel(storage,stripe,env,'funnelid',()=>now);
 const accept = offer=>({offer,accepted:true,consentVersion:CONSENT_VERSION});
 return {funnel,values,storage,stripe,session,calls,accept,get payment(){return payment},set payment(p){payment=p},get subscription(){return subscription}};
}
const start = f=>f.funnel.start({consent:true,consentVersion:CONSENT_VERSION});
test('save consent is explicit and versioned; no consent cannot create checkout',async()=>{
 const f=fixture();await assert.rejects(f.funnel.start({consent:false}),/agree/);assert.equal(f.calls.length,0);
 await start(f);const params=f.calls.find(c=>c[0]==='checkout')[1];assert.equal(params.payment_intent_data.setup_future_usage,'off_session');assert.equal(params.customer,'cus_mock');assert.equal(params.line_items[0].price,'price_initial');
 assert.deepEqual(params.allowed_payment_method_types,['card']);
 await start(f);assert.equal(f.calls.filter(c=>c[0]==='checkout').length,1);
});
test('unpaid, wrong amount, and customer mismatch cannot charge a saved card',async()=>{
 for(const change of [{payment_status:'unpaid'},{amount_total:494},{customer:'cus_other'}]){const f=fixture();await start(f);Object.assign(f.session,change);await assert.rejects(f.funnel.purchase(f.accept('us')),/not confirmed/);assert.equal(f.calls.filter(c=>c[0]==='create').length,0);}
});
test('a session ID alone cannot claim another browser purchase',async()=>{
 const f=fixture();await assert.rejects(f.funnel.summary({sessionId:'cs_test_initial'}),/expired/);
 await start(f);f.session.metadata.genesis_funnel='another';await assert.rejects(f.funnel.summary(),/not confirmed/);
});
test('rejects nonreusable methods and mismatched saved-card customer',async()=>{
 for(const change of [{type:'link'},{customer:'cus_other'}]){const f=fixture();await start(f);Object.assign(f.session.payment_intent.payment_method,change);await assert.rejects(f.funnel.purchase(f.accept('us')),/cannot be reused/);}
});
test('server controls $97 and $47; repeated requests reuse one charge',async()=>{
 for(const [offer,amount] of [['us',9700],['ds',4700]]){const f=fixture();await start(f);
  assert.deepEqual(await f.funnel.purchase({...f.accept(offer),amount:1,customer:'cus_attacker'}),{status:'succeeded',next:'/accelerator/'});
  await f.funnel.purchase(f.accept(offer));assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
  const params=f.calls.find(c=>c[0]==='create')[1];assert.equal(params.amount,amount);assert.equal(params.customer,'cus_mock');assert.equal(params.payment_method,'pm_mock');
 }
});
test('webinar and downsell are mutually exclusive even during SCA',async()=>{
 const f=fixture();await start(f);f.payment.status='requires_action';await f.funnel.purchase(f.accept('us'));
 await assert.rejects(f.funnel.purchase(f.accept('ds')),/different webinar/);assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
});
test('SCA returns a client secret; status checks never create charges',async()=>{
 const f=fixture();await start(f);f.payment.status='requires_action';const result=await f.funnel.purchase(f.accept('us'));
 assert.equal(result.status,'requires_action');assert.equal(result.clientSecret,f.payment.client_secret);
 f.payment.status='succeeded';assert.equal((await f.funnel.status({offer:'us'})).status,'succeeded');assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
});
test('declines retain the PaymentIntent and cannot create duplicate charges on retry',async()=>{
 const f=fixture();await start(f);f.stripe.paymentIntents.confirm=async()=>{f.payment.status='requires_payment_method';throw {payment_intent:f.payment}};
 assert.equal((await f.funnel.purchase(f.accept('ds'))).status,'failed');await f.funnel.purchase(f.accept('ds'));assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
});
test('expired or risk-blocked session cannot buy',async()=>{
 for(const change of [{expires:now},{blocked:true}]){const f=fixture();await start(f);Object.assign(f.values.get('record'),change);await assert.rejects(f.funnel.purchase(f.accept('us')),/expired/);}
});
test('wrong price configuration fails before creating a charge',async()=>{
 const f=fixture();await start(f);f.stripe.prices.retrieve=async()=>({active:true,unit_amount:100,currency:'usd',type:'one_time'});await assert.rejects(f.funnel.purchase(f.accept('us')),/unavailable/);assert.equal(f.calls.filter(c=>c[0]==='create').length,0);
});
test('accelerator starts capped, uses saved method, and never recreates subscription',async()=>{
 const f=fixture();await start(f);assert.equal((await f.funnel.purchase(f.accept('accelerator'))).status,'succeeded');await f.funnel.purchase(f.accept('accelerator'));
 const creates=f.calls.filter(c=>c[0]==='subscription');assert.equal(creates.length,1);assert.equal(creates[0][1].default_payment_method,'pm_mock');assert.ok(creates[0][1].cancel_at>now);assert.equal(creates[0][1].items[0].price,'price_acc');assert.equal(f.calls.filter(c=>c[0]==='cap').length,1);
});
test('subscription requiring bank verification only proceeds after paid invoice and cap',async()=>{
 const f=fixture();await start(f);let sub={id:'sub_mock',status:'incomplete',billing_cycle_anchor:now,latest_invoice:{status:'open',confirmation_secret:{client_secret:'pi_sub_secret_mock'}}};
 f.stripe.subscriptions.create=async()=>sub;f.stripe.subscriptions.retrieve=async()=>sub;f.stripe.subscriptions.update=async(id,p)=>({...sub,cancel_at:p.cancel_at});
 const result=await f.funnel.purchase(f.accept('accelerator'));assert.equal(result.status,'requires_action');assert.equal(result.clientSecret,'pi_sub_secret_mock');
 assert.equal((await f.funnel.status({offer:'accelerator'})).status,'processing');sub.status='active';sub.latest_invoice.status='paid';assert.equal((await f.funnel.status({offer:'accelerator'})).status,'succeeded');
});
test('router cannot expose internal webhook actions and requires bearer authorization',async()=>{
 const ready={ONE_CLICK_ENABLED:'true',ONE_CLICK_STRIPE_KEY:'mock',FUNNEL_SESSIONS:{}};
 assert.equal((await funnelRoute(new Request('https://api/funnel/event',{method:'POST'}),ready)).status,404);
 assert.equal((await funnelRoute(new Request('https://api/funnel/purchase',{method:'POST'}),ready)).status,401);
});
test('Durable Object queues concurrent requests across awaits',async()=>{
 let running=0,max=0;
 const ctx={id:{toString:()=> 'id'},storage:{get:async()=>{running++;max=Math.max(max,running);await new Promise(r=>setTimeout(r,5));running--;return null}}};
 const object=new FunnelSession(ctx,{ONE_CLICK_STRIPE_KEY:'mock'});
 await Promise.all([1,2,3].map(()=>object.fetch(new Request('https://internal/summary',{method:'POST',body:'{}'}))));assert.equal(max,1);
});
