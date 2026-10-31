import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/funnel-tracking.js',import.meta.url),'utf8');
function page(hostname='genesiscontent.io',storage=new Map()) {
 const calls=[];const window={fbq:(...args)=>calls.push(args)};
 vm.runInNewContext(source,{window,location:{hostname,pathname:'/accelerator/'},document:{querySelectorAll:()=>[]},Set,crypto:{randomUUID:()=> 'random-id'},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
 return {calls,tracking:window.genesisTracking,storage};
}
test('page load sends views, never a purchase',()=>{const p=page();assert.deepEqual(p.calls.map(c=>c[2]).filter(Boolean),['PageView','ViewContent']);});
test('confirmed purchases have actual value and no bearer in event data, reloads deduplicate',()=>{
 const p=page();p.tracking.purchase('accelerator','private-bearer');p.tracking.purchase('accelerator','private-bearer');
 const events=p.calls.filter(c=>c[2]==='Purchase');assert.equal(events.length,1);assert.equal(events[0][3].value,97);assert.equal(events[0][3].currency,'USD');assert.ok(!JSON.stringify(events).includes('private-bearer'));
 const again=page('genesiscontent.io',p.storage);again.tracking.purchase('accelerator','private-bearer');assert.equal(again.calls.filter(c=>c[2]==='Purchase').length,0);
});
test('separate offers each count once, and checkout clicks are not purchases',()=>{
 const p=page();p.tracking.checkout('us');p.tracking.checkout('us');assert.equal(p.calls.filter(c=>c[2]==='InitiateCheckout').length,1);assert.equal(p.calls.filter(c=>c[2]==='Purchase').length,0);
 p.tracking.purchase('free','session');p.tracking.purchase('us','token');assert.deepEqual(p.calls.filter(c=>c[2]==='Purchase').map(c=>c[3].value),[4.95,97]);
});
test('staging never emits live pixel events',()=>{assert.equal(page('genesis-one-click-staging.xecvtive.workers.dev').calls.length,0)});
test('fresh pixel loader queues the initialization and both view events',()=>{
 const window={};const scripts=[];
 const document={createElement:()=>({}),getElementsByTagName:()=>[{parentNode:{insertBefore:s=>scripts.push(s)}}],querySelectorAll:()=>[]};
 vm.runInNewContext(source,{window,document,location:{hostname:'genesiscontent.io',pathname:'/free/'},Set});
 assert.equal(window.fbq,window._fbq);assert.equal(window.fbq.version,'2.0');
 assert.equal(scripts.length,1);assert.equal(scripts[0].src,'https://connect.facebook.net/en_US/fbevents.js');
 assert.deepEqual(Array.from(window.fbq.queue,a=>a[0]),['init','trackSingle','trackSingle']);
});
