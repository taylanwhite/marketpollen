/* Market Pollen service worker
 *
 * Goal: make the app cold-start instantly from the home screen even on slow
 * or unreachable networks, and gracefully serve cached pages when offline.
 *
 * Strategy:
 *  - App shell (HTML, JS, CSS, fonts, icons): stale-while-revalidate.
 *    Users see the last-known shell instantly; we fetch a fresh copy in the
 *    background and use it on the next load.
 *  - API responses (/api/*): network-first, falling back to cache only for
 *    GETs. POST/PATCH/DELETE intentionally never touch this cache — the
 *    offline write queue (IndexedDB) handles those.
 *  - Navigation requests: try the network first so a deploy reaches users
 *    quickly; fall back to the cached shell when offline so the SPA boots
 *    and the in-app offline UI takes over.
 *
 * Bump CACHE_VERSION to invalidate caches after a deploy.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `mp-shell-${CACHE_VERSION}`;
const API_CACHE = `mp-api-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/assets/favicon.ico',
  '/assets/favicon-16.png',
  '/assets/favicon-32.png',
  '/assets/apple-touch-icon.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/sidemenu-logo-48.png',
  '/assets/sidemenu-logo-96@2x.png',
  '/assets/nav-title-220x40.png',
  '/assets/nav-title-440x80@2x.png',
  '/assets/site.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== API_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isNavigationRequest(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))
  );
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (request.method === 'GET' && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    if (request.method === 'GET') {
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    throw err;
  }
}

async function navigationStrategy(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/index.html', response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = (await cache.match('/index.html')) || (await cache.match('/'));
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' && !isApiRequest(new URL(request.url))) return;

  const url = new URL(request.url);

  // Same-origin only
  if (url.origin !== self.location.origin) return;

  if (isApiRequest(url)) {
    if (request.method === 'GET') {
      event.respondWith(networkFirstApi(request));
    }
    // Writes are owned by the in-app outbox; let them pass through.
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(navigationStrategy(request));
    return;
  }

  // Static assets: stale-while-revalidate from the shell cache
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

// Allow the page to ask us to skip waiting (used on user-initiated reloads
// after a deploy is detected).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
