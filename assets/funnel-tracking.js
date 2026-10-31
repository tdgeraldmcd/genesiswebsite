(() => {
  // Keep preview/test traffic out of the live advertising dataset.
  if (location.hostname !== 'genesiscontent.io') return;
  const pixel = '1074670735061961';
  if (!window.fbq) {
    const fbq = window.fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
    window._fbq = fbq; fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0'; fbq.queue = [];
    const script = document.createElement('script'); script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js'; document.head.append(script);
  }
  window.fbq('init', pixel);
  const offers = {
    free: {value: 4.95, content_name: 'The Content Compass'},
    us: {value: 97, content_name: 'Cash Flow Content Webinar with Q&A'},
    ds: {value: 47, content_name: 'Cash Flow Content Webinar without Q&A'},
    accelerator: {value: 97, content_name: 'Cash Flow Content Accelerator — first payment'}
  };
  const page = location.pathname.split('/')[1];
  const seen = new Set();
  function send(name, offer, eventID) {
    try {
      const details = offers[offer]; if (!details) return;
      window.fbq('trackSingle', pixel, name, {...details, currency:'USD', content_ids:[offer], content_type:'product'}, eventID ? {eventID} : {});
    } catch { /* Analytics must never interrupt a payment or redirect. */ }
  }
  function checkout(offer) {
    if (seen.has(`checkout:${offer}`)) return;
    seen.add(`checkout:${offer}`); send('InitiateCheckout', offer);
  }
  function purchase(offer, orderKey) {
    if (!orderKey || !offers[offer]) return;
    // orderKey stays in this browser; never transmit the funnel bearer token.
    const key = `genesis-meta-paid:${offer}:${orderKey}`;
    if (seen.has(key)) return;
    try { if (sessionStorage.getItem(key)) return; } catch {}
    let eventID;
    try { eventID = `genesis-${crypto.randomUUID()}`; } catch { return; }
    send('Purchase', offer, eventID); seen.add(key);
    try { sessionStorage.setItem(key, eventID); } catch {}
  }
  window.genesisTracking = {checkout, purchase};
  window.fbq('trackSingle', pixel, 'PageView');
  send('ViewContent', page);
  // These links leave the site for a regular hosted checkout.
  document.querySelectorAll('a[href^="https://buy.stripe.com/"]').forEach(link => {
    link.addEventListener('click', () => { if (link.getAttribute('href').startsWith('https://buy.stripe.com/')) checkout(page); });
  });
})();
