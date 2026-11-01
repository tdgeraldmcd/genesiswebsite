(() => {
  // Keep local previews out of the live advertising dataset.
  if (location.hostname !== 'genesiscontent.io' || window.genesisClipsTracking) return;
  window.genesisClipsTracking = true;
  const pixel = '1074670735061961';
  !function(f,b,e,v,n,t,s) {
    if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];
    t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s);
  }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', pixel);
  window.fbq('trackSingle', pixel, 'PageView');

  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href !== '#order' && href !== 'https://app.iclosed.io/e/gns/thoughtleader') return;
    // A click is interest, not a completed qualifying form or booking.
    try {
      window.fbq('trackSingleCustom', pixel, 'BookInterviewClick', {
        content_name: 'Free Thought Leadership Clips',
        page_path: '/clips/',
        button_location: link.closest('header') ? 'header' :
          link.closest('.sticky-offer') ? 'sticky' :
          link.closest('.hero') ? 'hero' :
          link.closest('section')?.id || 'body',
        destination: href === '#order' ? 'embedded_calendar' : 'external_calendar'
      });
    } catch { /* Tracking must never prevent visitors from booking. */ }
  });
})();
