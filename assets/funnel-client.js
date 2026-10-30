(() => {
  const key = 'genesis-funnel-v1';
  const config = window.genesisCheckout || {};
  const consentVersion = '2026-10-30-v1';
  function token(create = false) {
    let value = sessionStorage.getItem(key);
    if (!value && create) {
      value = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(key, value);
    }
    return value;
  }
  async function api(action, input = {}, create = false) {
    const bearer = token(create);
    if (!bearer) throw new Error('Your saved payment session is unavailable. Please use secure checkout.');
    const response = await fetch(`${config.apiOrigin}/funnel/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(input), signal: AbortSignal.timeout(45000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The purchase could not be confirmed. Check its status before retrying.');
    return result;
  }
  let stripeLoad;
  async function stripe(publishableKey) {
    if (!window.Stripe) {
      stripeLoad ||= new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = 'https://js.stripe.com/v3/';
        script.onload = resolve; script.onerror = reject; document.head.append(script);
      });
      await stripeLoad;
    }
    return window.Stripe(publishableKey);
  }
  window.genesisFunnel = { enabled: config.oneClick === true, consentVersion, api, token, stripe };
})();
