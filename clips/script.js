(() => {
  const params = new URLSearchParams(location.search);
  const fields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
  const touch = { landing_page: location.href, referrer: document.referrer, captured_at: new Date().toISOString() };
  fields.forEach(field => { touch[field] = params.get(field) || ''; });
  try {
    if (!localStorage.getItem('first_touch_attribution')) localStorage.setItem('first_touch_attribution', JSON.stringify(touch));
    if (fields.some(field => touch[field]) || !localStorage.getItem('latest_touch_attribution')) localStorage.setItem('latest_touch_attribution', JSON.stringify(touch));
  } catch { /* Navigation must work even when browser storage is unavailable. */ }
  document.querySelectorAll('a[href="#order"]').forEach(link => {
    link.addEventListener('click', () => {
      if (typeof window.fbq === 'function') window.fbq('trackCustom', 'ContentCompassOfferClick');
      if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: 'content_compass_offer_click' });
    });
  });
  document.querySelectorAll('.checkout-button').forEach(link => {
    link.addEventListener('click', () => {
      if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: 'begin_checkout', ecommerce: { currency: 'USD', value: 4.95, items: [{ item_id: 'content-compass', item_name: 'The Content Compass', price: 4.95, quantity: 1 }] } });
    });
  });
})();
