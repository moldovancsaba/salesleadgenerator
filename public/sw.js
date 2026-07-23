// Minimal service worker for PWA installability.
//
// Deliberately does NOT cache page navigations or /api/* responses — this
// app's kanban/lead data is live and changes constantly, so caching it here
// would risk serving stale pipeline state. Only the static app-shell assets
// (manifest, icons) are precached; everything else passes straight through
// to the network untouched.

const CACHE_NAME = 'slg-shell-v1';
const SHELL_ASSETS = ['/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellAsset = SHELL_ASSETS.includes(url.pathname);

  if (!isShellAsset) {
    return; // let the browser handle everything else normally (network)
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
