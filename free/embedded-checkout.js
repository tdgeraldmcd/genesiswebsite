(async () => {
  const apiOrigin = window.genesisCheckout?.apiOrigin;
  if (!apiOrigin) return; // Keep the verified Payment Link until deployment is ready.
  const root = document.getElementById('embedded-checkout');
  const status = document.getElementById('embedded-status');
  const fallback = document.querySelector('.order-card .checkout-button');
  if (!root || !status || !fallback) return;
  let instance;
  let loading = false;
  let completed = false;
  const returnSession = new URLSearchParams(location.search).get('session_id');
  const api = async (path, body = {}) => {
    const response = await fetch(`${apiOrigin.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Checkout unavailable');
    return response.json();
  };
  const loadStripe = () => new Promise((resolve, reject) => {
    if (window.Stripe) return resolve();
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/'; script.onload = resolve; script.onerror = reject;
    document.head.append(script);
  });
  async function confirm(sessionId) {
    const result = await api('/status', { sessionId });
    if (!result.paid) { status.textContent = 'Your payment is not confirmed yet. Check your Stripe receipt or contact (914) 455-0381 before paying again.'; return; }
    completed = true; instance?.destroy(); root.hidden = true; fallback.hidden = true;
    status.textContent = 'Payment confirmed. Thank you for purchasing The Content Compass.';
    // Continue the funnel only after the backend confirms payment.
    if (window.genesisCheckout.successPath === '/us') location.assign('/us');
  }
  async function start() {
    if (loading || instance || completed) return;
    loading = true;
    root.hidden = false; status.hidden = false;
    status.textContent = 'Loading secure checkout…';
    try {
      if (returnSession) {
        await confirm(returnSession);
        return;
      }
      await loadStripe();
      const session = await api('/session');
      const stripe = window.Stripe(session.publishableKey);
      instance = await stripe.createEmbeddedCheckoutPage({
        fetchClientSecret: async () => session.clientSecret,
        onComplete: async () => {
          status.textContent = 'Confirming your payment…';
          try {
            await confirm(session.sessionId);
          } catch {
            status.textContent = 'We could not confirm your payment status. Check your Stripe receipt or contact (914) 455-0381 before trying another payment.';
          }
        }
      });
      instance.mount('#embedded-checkout');
      status.textContent = 'Secure checkout powered by Stripe.';
    } catch {
      instance?.destroy(); instance = null; root.hidden = true;
      if (returnSession) { status.textContent = 'We could not confirm your payment. Please check your Stripe receipt or contact (914) 455-0381 before paying again.'; return; }
      status.textContent = 'The embedded form could not load. You can still purchase using the Stripe checkout link below.';
    } finally { loading = false; }
  }
  document.querySelectorAll('.checkout-button').forEach(link => {
    if (link === fallback) return;
    link.href = '#order';
    link.addEventListener('click', start);
  });
  new IntersectionObserver((entries, observer) => {
    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); start(); }
  }).observe(root.parentElement);
})();
