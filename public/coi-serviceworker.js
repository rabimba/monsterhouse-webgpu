/*! MonsterHouse WebGPU Cross-Origin Isolation ServiceWorker for GitHub Pages */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') {
      return;
    }
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.status === 0) {
            return response;
          }
          const newHeaders = new Headers(response.headers);
          newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
          newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        })
        .catch((err) => {
          console.error('[coi-sw] fetch error:', err);
          throw err;
        }),
    );
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register(new URL('./coi-serviceworker.js', window.location.href).href)
    .then((registration) => {
      if (registration.active && !navigator.serviceWorker.controller) {
        if (!sessionStorage.getItem('mh_coi_reloaded')) {
          sessionStorage.setItem('mh_coi_reloaded', '1');
          window.location.reload();
        }
      } else if (registration.installing) {
        registration.installing.addEventListener('statechange', function () {
          if (this.state === 'activated' && !sessionStorage.getItem('mh_coi_reloaded')) {
            sessionStorage.setItem('mh_coi_reloaded', '1');
            window.location.reload();
          }
        });
      }
    })
    .catch((err) => {
      console.warn('[coi-sw] registration skipped:', err);
    });
}
