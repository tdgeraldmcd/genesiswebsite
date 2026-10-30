import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/one-click-upsell.js',import.meta.url),'utf8');
class Element {
 constructor(){this.events={};this.children=[];this.textContent='Buy';this.attrs={}}
 addEventListener(name,fn){this.events[name]=fn}
 after(node){this.children.push(node)}
 setAttribute(k,v){this.attrs[k]=v}
 removeAttribute(k){delete this.attrs[k]}
}
async function page({api,token='token',enabled=true,confirm=async()=>({})}={}) {
 const purchase=new Element();const redirects=[];const requests=[];let confirms=0;
 const context={window:{genesisFunnel:{enabled,token:()=>token,consentVersion:'2026-10-30-v1',
  api:async(action,input)=>{requests.push([action,input]);if(api)return api(action,input);return action==='summary'?{ready:true,card:{brand:'visa',last4:'4242'}}:{status:'not_started'}},
  stripe:async()=>({confirmCardPayment:async secret=>{confirms++;return confirm(secret)}})}},
  document:{body:{dataset:{upsell:'us'}},querySelector:()=>purchase,createElement:()=>new Element()},
  location:{assign:url=>redirects.push(url)}};
 await vm.runInNewContext(source,context);
 async function click(){let prevented=false;await purchase.events.click?.({preventDefault(){prevented=true}});return prevented}
 return {purchase,redirects,requests,click,get confirms(){return confirms}};
}
test('loading an upsell page never creates a purchase',async()=>{const p=await page();assert.deepEqual(p.requests.map(r=>r[0]),['summary','status']);assert.equal(p.redirects.length,0)});
test('explicit acceptance sends fixed offer and redirects only on success',async()=>{
 const p=await page({api:async action=>action==='summary'?{ready:true,card:{brand:'visa',last4:'4242'}}:action==='purchase'?{status:'succeeded',next:'/accelerator/'}:{status:'not_started'}});
 assert.equal(await p.click(),true);assert.equal(p.requests.filter(r=>r[0]==='purchase').length,1);assert.equal(p.requests.at(-1)[1].accepted,true);assert.deepEqual(p.redirects,['/accelerator/']);
});
test('double clicking during a pending request sends one purchase',async()=>{
 let release;const pending=new Promise(r=>release=r);
 const p=await page({api:async action=>action==='summary'?{ready:true,card:{brand:'visa',last4:'4242'}}:action==='purchase'?pending:{status:'not_started'}});
 const first=p.click();await p.click();release({status:'processing'});await first;assert.equal(p.requests.filter(r=>r[0]==='purchase').length,1);
});
test('required bank verification is completed before final payment status check',async()=>{
 let purchased=false;
 const p=await page({api:async action=>{
  if(action==='summary')return {ready:true,card:{brand:'visa',last4:'4242'}};
  if(action==='purchase'){purchased=true;return {status:'requires_action',clientSecret:'secret',publishableKey:'pk_test'}};
  return purchased?{status:'succeeded',next:'/accelerator/'}:{status:'not_started'};
 }});
 await p.click();assert.equal(p.confirms,1);assert.deepEqual(p.redirects,['/accelerator/']);
});
test('uncertain session blocks silently falling back to a duplicate checkout',async()=>{
 const p=await page({api:async()=>{throw new Error('Expired session')}});assert.equal(await p.click(),true);assert.equal(p.requests.filter(r=>r[0]==='purchase').length,0);
});
test('fresh visitors retain a clearly labelled regular checkout option',async()=>{const p=await page({token:null});assert.equal(await p.click(),false);assert.equal(p.requests.length,0)});
test('feature disabled leaves the current live flow untouched',async()=>{const p=await page({enabled:false});assert.equal(p.purchase.events.click,undefined);assert.equal(p.requests.length,0)});
