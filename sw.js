const CACHE_NAME = 'cram-v3';

// Resolve relative paths to absolute URLs relative to this service worker script
const ASSET_URLS = [
  new URL('./', self.location).href,
  new URL('index.html', self.location).href,
  new URL('style.css', self.location).href,
  new URL('app.js', self.location).href,
  new URL('manifest.json', self.location).href,
  new URL('icons/icon-192.png', self.location).href,
  new URL('icons/icon-512.png', self.location).href
];

// Clean/sanitize responses to strip the "redirected" flag (fixes iOS Safari bug)
function cleanResponse(response) {
  if (!response || !response.redirected) {
    return response;
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

// Fetch and cache all assets on install, cleaning redirects
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSET_URLS.map((url) => {
          return fetch(url).then((response) => {
            if (!response.ok) {
              throw new Error(`Failed to fetch ${url}`);
            }
            return cache.put(url, cleanResponse(response));
          });
        })
      );
    })
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Cache-first with network fallback — works fully offline
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // For navigation requests (page loads), always try the cached index.html first
  if (event.request.mode === 'navigate') {
    const indexUrl = new URL('index.html', self.location).href;
    event.respondWith(
      caches.match(indexUrl).then((cachedResponse) => {
        return cachedResponse || fetch(event.request).then((response) => {
          return cleanResponse(response);
        }).catch(() => {
          return new Response('<h1>Cram is offline</h1><p>Please connect to the internet first to load the app.</p>', {
            headers: { 'Content-Type': 'text/html' }
          });
        });
      })
    );
    return;
  }

  // For other requests: cache first, then network fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // Cache new successful GET responses dynamically
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cleanResponse(clone));
          });
        }
        return response;
      }).catch(() => {
        // Return 404 for missing non-critical assets
        return new Response('', { status: 404 });
      });
    })
  );
});
