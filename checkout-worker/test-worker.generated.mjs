// Cloudflare Worker. Configure secrets in Cloudflare, never in this repository.
const checkoutBackend = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/webhook' && request.method === 'POST') return receiveWebhook(request, env);
    const origin = request.headers.get('Origin');
    const allowed = env.SITE_ORIGIN || 'https://genesiscontent.io';
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    if (origin === allowed) headers['Access-Control-Allow-Origin'] = allowed;
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (origin !== allowed) return reply({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PUBLISHABLE_KEY || !env.STRIPE_PRICE_ID) return reply({ error: 'Checkout unavailable' }, 503);
    const stripe = async (endpoint, body) => {
      const response = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2026-08-26.dahlia', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('Stripe request failed');
      return response.json();
    };
    try {
      if (path === '/session') {
        if (env.CHECKOUT_LIMITER) {
          const { success } = await env.CHECKOUT_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
          if (!success) return reply({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);
        }
        // Price and quantity are never accepted from the visitor.
        const price = await stripe(`prices/${encodeURIComponent(env.STRIPE_PRICE_ID)}`);
        if (!price.active || price.currency !== 'usd' || price.unit_amount !== 495 || price.type !== 'one_time') return reply({ error: 'Offer configuration needs attention' }, 503);
        const body = new URLSearchParams({
          mode: 'payment', ui_mode: 'embedded_page',
          'line_items[0][price]': env.STRIPE_PRICE_ID, 'line_items[0][quantity]': '1',
          redirect_on_completion: 'if_required',
          integration_identifier: 'genesis_compass_qmzwbnyr',
          return_url: `${allowed}/free/?session_id={CHECKOUT_SESSION_ID}#order`,
          'metadata[offer]': 'content-compass',
          'payment_intent_data[metadata][offer]': 'content-compass'
        });
        const session = await stripe('checkout/sessions', body);
        return reply({ clientSecret: session.client_secret, sessionId: session.id, publishableKey: env.STRIPE_PUBLISHABLE_KEY });
      }
      if (path === '/status') {
        const input = await request.json();
        if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(input.sessionId || '')) return reply({ error: 'Invalid session' }, 400);
        const session = await stripe(`checkout/sessions/${encodeURIComponent(input.sessionId)}`);
        if (session.metadata?.offer !== 'content-compass') return reply({ error: 'Unknown order' }, 404);
        const paid = session.status === 'complete' && session.payment_status === 'paid' && session.amount_total === 495 && session.currency === 'usd';
        // Return no email, address, card data, or other customer details.
        return reply({ paid, ...(paid ? { bookingUrl: 'https://app.iclosed.io/e/gns/thoughtleader', guideUrl: env.GUIDE_URL || null } : {}) });
      }
      return reply({ error: 'Not found' }, 404);
    } catch {
      return reply({ error: 'Checkout temporarily unavailable. Please use the secure payment link.' }, 502);
    }
  }
};


async function receiveWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.ORDERS) return new Response('Webhook not configured', {status:503});
  const raw = await request.text();
  if (raw.length > 1048576) return new Response('Payload too large', {status:413});
  const parts = (request.headers.get('stripe-signature') || '').split(',').map(part => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([,value]) => value);
  if (!/^\d+$/.test(timestamp || '') || Math.abs(Date.now()/1000-Number(timestamp)) > 300) return new Response('Invalid signature', {status:400});
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
    const message = new TextEncoder().encode(`${timestamp}.${raw}`);
    let verified = false;
    for (const signature of signatures) {
      if (!/^[a-f0-9]{64}$/.test(signature || '')) continue;
      const bytes = Uint8Array.from(signature.match(/../g), hex => parseInt(hex,16));
      if (await crypto.subtle.verify('HMAC', key, bytes, message)) verified = true;
    }
    if (!verified) return new Response('Invalid signature', {status:400});
    const event = JSON.parse(raw);
    if (!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'].includes(event.type)) return new Response('OK');
    const session = event.data.object;
    if (session.metadata?.offer !== 'content-compass') return new Response('OK');
    if (session.payment_status === 'paid' && session.amount_total === 495 && session.currency === 'usd') {
      // Repeated deliveries write the same order key; no duplicate emails or bookings.
      await env.ORDERS.put(`paid:${session.id}`, JSON.stringify({sessionId:session.id,email:session.customer_details?.email || null,paidAt:session.created,status:'paid',fulfillment:'pending'}));
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await env.ORDERS.put(`failed:${session.id}`, JSON.stringify({sessionId:session.id,status:'failed'}));
    }
    return new Response('OK');
  } catch { return new Response('Webhook processing failed', {status:500}); }
}

const testHtml="<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>Genesis Checkout — TEST ONLY</title><style>body{font:18px system-ui;margin:30px auto;padding:20px;max-width:1000px;background:#f6f4ee;color:#243b32}.banner{background:#ffe280;padding:20px}#embedded-checkout{min-height:360px}[hidden]{display:none!important}</style></head><body><h1>Genesis Content — TEST ONLY</h1><p class=\"banner\">Stripe test mode. Simulated payments only. No guide delivery or real charges.</p><main id=\"order\" class=\"order-card\"><h2>The Content Compass + FREE VIDEOS — $4.95</h2><p id=\"embedded-status\" role=\"status\" hidden></p><div id=\"embedded-checkout\" hidden></div><a class=\"checkout-button\" href=\"/free/\">Restart test checkout</a></main><script>window.genesisCheckout={apiOrigin:location.origin,successPath:''};</script><script src=\"/free/embedded-checkout.js\" defer></script></body></html>";
const testJs="(async () => {\n  const apiOrigin = window.genesisCheckout?.apiOrigin;\n  if (!apiOrigin) return; // Keep the verified Payment Link until deployment is ready.\n  const root = document.getElementById('embedded-checkout');\n  const status = document.getElementById('embedded-status');\n  const fallback = document.querySelector('.order-card .checkout-button');\n  if (!root || !status || !fallback) return;\n  let instance;\n  let loading = false;\n  let completed = false;\n  const returnSession = new URLSearchParams(location.search).get('session_id');\n  const api = async (path, body = {}) => {\n    const response = await fetch(`${apiOrigin.replace(/\\/$/, '')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });\n    if (!response.ok) throw new Error('Checkout unavailable');\n    return response.json();\n  };\n  const loadStripe = () => new Promise((resolve, reject) => {\n    if (window.Stripe) return resolve();\n    const script = document.createElement('script');\n    script.src = 'https://js.stripe.com/v3/'; script.onload = resolve; script.onerror = reject;\n    document.head.append(script);\n  });\n  async function confirm(sessionId) {\n    const result = await api('/status', { sessionId });\n    if (!result.paid) { status.textContent = 'Your payment is not confirmed yet. Check your Stripe receipt or contact (914) 455-0381 before paying again.'; return; }\n    completed = true; instance?.destroy(); root.hidden = true; fallback.hidden = true;\n    status.textContent = 'Payment confirmed. Thank you for purchasing The Content Compass.';\n    // Enable only when the planned /us upsell page has been created and checked.\n    if (window.genesisCheckout.successPath === '/us') location.assign('/us');\n  }\n  async function start() {\n    if (loading || instance || completed) return;\n    loading = true;\n    root.hidden = false; status.hidden = false;\n    status.textContent = 'Loading secure checkout…';\n    try {\n      if (returnSession) {\n        await confirm(returnSession);\n        return;\n      }\n      await loadStripe();\n      const session = await api('/session');\n      const stripe = window.Stripe(session.publishableKey);\n      instance = await stripe.createEmbeddedCheckoutPage({\n        fetchClientSecret: async () => session.clientSecret,\n        onComplete: async () => {\n          status.textContent = 'Confirming your payment…';\n          try {\n            await confirm(session.sessionId);\n          } catch {\n            status.textContent = 'We could not confirm your payment status. Check your Stripe receipt or contact (914) 455-0381 before trying another payment.';\n          }\n        }\n      });\n      instance.mount('#embedded-checkout');\n      status.textContent = 'Secure checkout powered by Stripe.';\n    } catch {\n      instance?.destroy(); instance = null; root.hidden = true;\n      if (returnSession) { status.textContent = 'We could not confirm your payment. Please check your Stripe receipt or contact (914) 455-0381 before paying again.'; return; }\n      status.textContent = 'The embedded form could not load. You can still purchase using the Stripe checkout link below.';\n    } finally { loading = false; }\n  }\n  document.querySelectorAll('.checkout-button').forEach(link => {\n    if (link === fallback) return;\n    link.href = '#order';\n    link.addEventListener('click', start);\n  });\n  new IntersectionObserver((entries, observer) => {\n    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); start(); }\n  }).observe(root.parentElement);\n})();\n";
export default {async fetch(request,env){const url=new URL(request.url);if(request.method==='GET'){if(url.pathname==='/'||url.pathname==='/free/')return new Response(testHtml,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'}});if(url.pathname==='/free/embedded-checkout.js')return new Response(testJs,{headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store'}});}if(!/^rk_test_/.test(env.STRIPE_SECRET_KEY||'')||!/^pk_test_/.test(env.STRIPE_PUBLISHABLE_KEY||''))return new Response('Test credentials required',{status:503});return checkoutBackend.fetch(request,env);}};
