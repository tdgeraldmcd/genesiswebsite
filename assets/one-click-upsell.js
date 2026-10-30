(async () => {
  const funnel = window.genesisFunnel;
  if (!funnel?.enabled) return;
  const offer = document.body.dataset.upsell;
  const purchases = [...document.querySelectorAll('.button.purchase')];
  if (!purchases.length || !['us', 'ds', 'accelerator'].includes(offer)) return;
  const controls = purchases.map(purchase => {
    const note = document.createElement('p'); note.className = 'purchase-note'; note.setAttribute('role', 'status');
    purchase.after(note);
    const check = document.createElement('button'); check.type = 'button'; check.className = 'decline';
    check.textContent = 'Check purchase status'; check.hidden = true; note.after(check);
    return {purchase, note, check, originalText: purchase.textContent};
  });
  const setNote = text => controls.forEach(({note}) => { note.textContent = text; });
  const showChecks = () => controls.forEach(({check}) => { check.hidden = false; });
  let ready = false, busy = false, attempted = false;
  function finish(result) {
    if (result.status === 'succeeded') {
      setNote('Payment confirmed. Continuing…');
      // Only fixed, expected destinations are allowed.
      const expected = offer === 'accelerator' ? 'https://app.iclosed.io/e/gns/thoughtleader' : '/accelerator/';
      if (result.next === expected) location.assign(expected);
      return true;
    }
    setNote(result.message || 'Your payment needs confirmation. Check the purchase status before trying again.');
    return false;
  }
  controls.forEach(({purchase, check}) => {
    purchase.addEventListener('click', async event => {
      if (!ready) {
        // A visitor without a saved-card session can use the existing regular Checkout link.
        if (attempted || busy) event.preventDefault();
        return;
      }
      event.preventDefault();
      if (busy) return;
      busy = true; attempted = true; showChecks();
      controls.forEach(({purchase}) => { purchase.setAttribute('aria-disabled', 'true'); purchase.textContent = 'Confirming…'; });
      try {
        const result = await funnel.api('purchase', { offer, accepted: true, consentVersion: funnel.consentVersion });
        if (result.status === 'requires_action') {
          setNote('Your bank requires verification. Follow the secure Stripe prompt.');
          const stripe = await funnel.stripe(result.publishableKey);
          const confirmation = await stripe.confirmCardPayment(result.clientSecret);
          if (confirmation.error) throw new Error(confirmation.error.message || 'Payment verification was not completed.');
          finish(await funnel.api('status', { offer }));
        } else finish(result);
      } catch (error) { setNote(error.message); }
      finally { busy = false; controls.forEach(({purchase, originalText}) => { purchase.removeAttribute('aria-disabled'); purchase.textContent = originalText; }); }
    });
    check.addEventListener('click', async () => {
      if (busy) return;
      busy = true; check.disabled = true;
      try { finish(await funnel.api('status', { offer })); }
      catch (error) { setNote(error.message); }
      finally { busy = false; check.disabled = false; }
    });
  });
  try {
    if (!funnel.token()) { setNote('Use secure checkout to purchase this offer.'); return; }
    // Block the regular Payment Link while validating the saved-card session.
    busy = true;
    const state = await funnel.api('summary');
    ready = state.ready;
    const amount = offer === 'us' ? '$97 once' : offer === 'ds' ? '$47 once' : '$97 today, then $97 monthly for 11 more payments ($1,164 total)';
    setNote(`Clicking this button charges your saved ${state.card.brand} ending in ${state.card.last4}: ${amount}.`);
    const existing = await funnel.api('status', {offer});
    if (existing.status !== 'not_started') { attempted = true; showChecks(); finish(existing); }
  } catch (error) {
    // An expired/uncertain existing session must not silently open a second checkout.
    attempted = true; setNote(error.message);
  } finally { busy = false; }
})();
