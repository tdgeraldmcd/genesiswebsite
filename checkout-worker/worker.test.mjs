import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const env = { STRIPE_SECRET_KEY:'sk_test_mock', STRIPE_PUBLISHABLE_KEY:'pk_test_mock', STRIPE_PRICE_ID:'price_mock' };
const req = (path, body = {}, origin = 'https://genesiscontent.io') => new Request(`https://checkout.example${path}`, { method:'POST', headers:{Origin:origin,'Content-Type':'application/json'}, body:JSON.stringify(body) });
test('rejects an unapproved browser origin', async()=>assert.equal((await worker.fetch(req('/session',{},'https://elsewhere.example'),env)).status,403));
test('fails closed without credentials',async()=>assert.equal((await worker.fetch(req('/session'),{})).status,503));
test('rejects visitor-controlled session identifiers',async()=>assert.equal((await worker.fetch(req('/status',{sessionId:'../../customers'}),env)).status,400));
test('server owns the offer price and quantity',async(t)=>{
 let form;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
   if(url.includes('/prices/')) return Response.json({active:true,currency:'usd',unit_amount:495,type:'one_time'});
   form=options.body;return Response.json({id:'cs_test_mock',client_secret:'secret_mock'});
 });
 const res=await worker.fetch(req('/session',{price:1,quantity:100}),env);
 assert.equal(res.status,200);assert.equal(form.get('line_items[0][price]'),'price_mock');assert.equal(form.get('line_items[0][quantity]'),'1');
 assert.equal(form.get('mode'),'payment');assert.equal(form.get('ui_mode'),'embedded_page');
 assert.equal((await res.json()).publishableKey,'pk_test_mock');
});
test('wrong configured price cannot charge a visitor',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({active:true,currency:'usd',unit_amount:4995,type:'one_time'}));
 assert.equal((await worker.fetch(req('/session'),env)).status,503);
});
test('only paid matching orders are confirmed; no customer details escape',async(t)=>{
 let paid=false;
 t.mock.method(globalThis,'fetch',async()=>Response.json({metadata:{offer:'content-compass'},status:'complete',payment_status:paid?'paid':'unpaid',amount_total:495,currency:'usd',customer_details:{email:'private@example.com'}}));
 assert.deepEqual(await (await worker.fetch(req('/status',{sessionId:'cs_test_mock'}),env)).json(),{paid:false});
 paid=true;
 assert.deepEqual(await (await worker.fetch(req('/status',{sessionId:'cs_test_mock'}),env)).json(),{paid:true,bookingUrl:'https://app.iclosed.io/e/gns/thoughtleader',guideUrl:null});
});
test('Stripe failures return no credentials or provider payload',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('private provider error',{status:401}));
 const res=await worker.fetch(req('/session'),env);assert.equal(res.status,502);assert.doesNotMatch(await res.text(),/sk_test|private provider/);
});

test('webhooks reject invalid signatures before recording orders',async()=>{
 let written=false;
 const res=await worker.fetch(new Request('https://checkout.example/webhook',{method:'POST',body:'{}'}),{STRIPE_WEBHOOK_SECRET:'test_webhook',ORDERS:{put:async()=>{written=true;}}});
 assert.equal(res.status,400);assert.equal(written,false);
});
test('signed paid webhook records a single stable order key, unpaid does not',async()=>{
 const { createHmac }=await import('node:crypto');
 const orders=new Map();
 const config={STRIPE_WEBHOOK_SECRET:'test_webhook',ORDERS:{put:async(k,v)=>orders.set(k,v)}};
 const event={type:'checkout.session.completed',data:{object:{id:'cs_test_mock',metadata:{offer:'content-compass'},amount_total:495,currency:'usd',payment_status:'unpaid',created:1}}};
 async function deliver(){
  const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000);
  const sig=createHmac('sha256','test_webhook').update(`${timestamp}.${raw}`).digest('hex');
  return worker.fetch(new Request('https://checkout.example/webhook',{method:'POST',headers:{'Stripe-Signature':`t=${timestamp},v1=${sig}`},body:raw}),config);
 }
 assert.equal((await deliver()).status,200);assert.equal(orders.size,0);
 event.data.object.payment_status='paid';
 assert.equal((await deliver()).status,200);assert.equal((await deliver()).status,200);assert.equal(orders.size,1);
});

test('rate limits session creation before calling Stripe',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Unexpected request');});
 const res=await worker.fetch(req('/session'),{...env,CHECKOUT_LIMITER:{limit:async()=>({success:false})}});
 assert.equal(res.status,429);assert.equal(calls,0);
});
