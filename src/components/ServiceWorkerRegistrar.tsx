'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (see public/sw.js) for offline support and
 * instant cold starts. Production only — in dev the SW would cache assets and
 * fight Next.js HMR. Renders nothing.
 *
 * The SW serves the app shell stale-while-revalidate, so a fresh deploy is
 * picked up one launch later. To close that gap it posts `shell-updated` when
 * the revalidated shell differs; we reload at the next safe moment — when the
 * page goes to the background — so the user never sees a reload mid-tap and
 * comes back to the new build.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let pendingUpdate = false;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'shell-updated') pendingUpdate = true;
    };

    const onVisibility = () => {
      if (pendingUpdate && document.visibilityState === 'hidden') {
        pendingUpdate = false;
        location.reload();
      }
    };

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration is best-effort; the app works fine without it.
      });
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisibility);

    const cleanup = () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    if (document.readyState === 'complete') {
      register();
      return cleanup;
    }

    window.addEventListener('load', register);
    return () => {
      window.removeEventListener('load', register);
      cleanup();
    };
  }, []);

  return null;
}
