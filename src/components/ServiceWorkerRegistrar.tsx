'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (see public/sw.js) for offline support and
 * instant cold starts. Production only — in dev the SW would cache assets and
 * fight Next.js HMR. Renders nothing.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Registration is best-effort; the app works fine without it.
      });
    };

    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
