/*
 * Spendly service worker
 *
 * Goals: instant cold starts and offline support for the installed PWA, without
 * ever serving stale application code.
 *
 * Strategy:
 *  - Immutable, content-hashed assets (`/_next/static/…`), icons and fonts →
 *    cache-first. Safe because their filenames change on every build, so a new
 *    deploy references new URLs and old entries are simply never requested again.
 *  - Navigation requests (HTML) → network-first with an offline fallback to the
 *    cached app shell. Online users always get the freshest HTML (and therefore
 *    the newest asset hashes); offline users still get a working shell that
 *    hydrates from localStorage caches.
 *  - Cross-origin requests (Supabase, currency API) → not intercepted at all, so
 *    data and auth always hit the network with fresh responses.
 *  - Old caches are purged on activate.
 *
 * Bump CACHE_VERSION to force a full cache purge on the next visit.
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `spendly-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `spendly-runtime-${CACHE_VERSION}`;
const KEEP = new Set([STATIC_CACHE, RUNTIME_CACHE]);

self.addEventListener('install', () => {
  // Activate this SW as soon as it finishes installing.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const STATIC_ASSET_RE = /\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf)$/i;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only ever touch same-origin requests. Supabase / currency API pass straight
  // through to the network so data and auth are never served from cache.
  if (url.origin !== self.location.origin) return;

  // Immutable build output → cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Static images / fonts / manifest → cache-first.
  if (STATIC_ASSET_RE.test(url.pathname) || url.pathname === '/manifest.json') {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // HTML navigations → network-first with offline shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Fall back to the cached app shell so the PWA still opens offline.
    const shell = await cache.match('/');
    if (shell) return shell;
    throw err;
  }
}
