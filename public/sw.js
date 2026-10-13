// Progressive Web App Service Worker — Sales Lead Generator
//
// Self-hosted, dependency-free offline shell and asset caching.
//
// Invariant: Live CRM and pipeline data (/api/* and page data) is never served stale.
// Navigation requests use network-first strategy, falling back to the precached
// /offline shell when connectivity is completely unavailable.
// Static Next.js bundles and icons are cached to ensure instant app launch.

const CACHE_NAME = 'slg-shell-v2';

const SHELL_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/maskable-icon-512.png',
  '/apple-touch-icon.png',
  '/offline',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Precache assets; individual failures (e.g. during dev) do not block install
      return Promise.allSettled(
        SHELL_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn(`[PWA SW] Precache failed for ${asset}:`, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // 1. Navigation requests (HTML page loads): Network-first with /offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cachedOffline = await caches.match('/offline');
        if (cachedOffline) {
          return cachedOffline;
        }
        return new Response('Offline: Network unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        });
      })
    );
    return;
  }

  // 2. Precached shell assets & icons: Cache-first
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // 3. Static Next.js hashed assets: Cache-first with network fallback & background cache
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 4. API routes: Network-only with JSON offline fallback if network drops
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Network unavailable. Device is offline.', offline: true }),
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // 5. All other requests pass through to network
});
