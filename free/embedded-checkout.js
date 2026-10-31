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
  const funnel = window.genesisFunnel;
  let saveConsent = false;
  let consentPrompt;
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
    const result = funnel?.enabled && funnel.token()
      ? { paid: (await funnel.api('summary')).ready }
      : await api('/status', { sessionId });
    if (!result.paid) { status.textContent = 'Your payment is not confirmed yet. Check your Stripe receipt or contact (914) 455-0381 before paying again.'; return; }
    window.genesisTracking?.purchase('free', sessionId);
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
      if (funnel?.enabled && !saveConsent) {
        status.textContent = 'Choose how to continue to your $4.95 checkout.';
        if (!consentPrompt) {
          consentPrompt = document.createElement('div');
          consentPrompt.className = 'checkout-consent';
          const label = document.createElement('label');
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
          label.append(checkbox, document.createTextNode(' Save my payment method for optional offers I explicitly accept next. The initial purchase is $4.95. Any accelerator subscription requires my separate acceptance of $97/month for 12 payments.'));
          const proceed = document.createElement('button'); proceed.type = 'button'; proceed.className = 'button';
          proceed.textContent = 'Continue to secure checkout'; proceed.disabled = true;
          checkbox.addEventListener('change', () => { proceed.disabled = !checkbox.checked; });
          proceed.addEventListener('click', () => { saveConsent = checkbox.checked; consentPrompt.hidden = true; start(); });
          const regular = document.createElement('a'); regular.href = fallback.href; regular.className = 'decline';
          regular.textContent = 'Continue without saving my payment method';
          consentPrompt.append(label, proceed, regular); root.before(consentPrompt);
        }
        root.hidden = true;
        return;
      }
      await loadStripe();
      const session = funnel?.enabled
        ? await funnel.api('start', { consent: true, consentVersion: funnel.consentVersion }, true)
        : await api('/session');
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
      window.genesisTracking?.checkout('free');
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
