/*
 * Spendly service worker
 *
 * Goals: instant cold starts and offline support for the installed PWA, without
 * ever getting stuck on stale application code.
 *
 * Strategy:
 *  - Immutable, content-hashed assets (`/_next/static/…`), icons and fonts →
 *    cache-first. Safe because their filenames change on every build, so a new
 *    deploy references new URLs and old entries are simply never requested again.
 *  - Navigation requests (HTML) → stale-while-revalidate. The app shell is static
 *    (no per-request server rendering) and every screen hydrates from localStorage
 *    + Supabase, so there is nothing to gain from making the user wait on an HTML
 *    round-trip before first paint. We serve the cached shell instantly and
 *    revalidate in the background; when the revalidation turns up a different
 *    shell (new deploy → new chunk hashes) we notify the page, which reloads the
 *    next time it goes to the background so the user never sees it happen.
 *    First-ever visit has no cached shell and simply falls through to the network.
 *  - Cross-origin requests (Supabase, currency API) → not intercepted at all, so
 *    data and auth always hit the network with fresh responses.
 *  - Old caches are purged on activate.
 *
 * Bump CACHE_VERSION to force a full cache purge on the next visit.
 */

const CACHE_VERSION = 'v2';
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

  // HTML navigations → stale-while-revalidate (instant paint from cache).
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(event, request, RUNTIME_CACHE));
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

/**
 * Serve the cached shell immediately (if any) and refresh it in the background.
 * With no cache we fall back to the network, and with neither we serve the
 * cached `/` shell so the installed PWA still opens offline from any URL.
 */
async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = (await cache.match(request)) || (await cache.match('/'));

  const network = fetch(request)
    .then(async (response) => {
      if (!response.ok) return response;
      // Compare against what we served so a new deploy can announce itself.
      const fresh = response.clone();
      const changed = cached ? !(await sameBody(cached.clone(), response.clone())) : false;
      await cache.put(request, fresh);
      if (changed) await notifyClients();
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Keep the SW alive until the background refresh settles.
    event.waitUntil(network);
    return cached;
  }

  const response = await network;
  if (response) return response;
  throw new Error('offline and no cached shell');
}

async function sameBody(a, b) {
  try {
    const [ta, tb] = await Promise.all([a.text(), b.text()]);
    return ta === tb;
  } catch {
    // Unreadable body → assume unchanged rather than nagging for a reload.
    return true;
  }
}

async function notifyClients() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) client.postMessage({ type: 'shell-updated' });
}
