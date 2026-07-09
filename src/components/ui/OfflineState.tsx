'use client';

import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * Shown by views that have no offline cache (Reflect, Budgets, …) when a load
 * fails for lack of connection. Beats hanging on a doomed request and then
 * rendering misleading zeros. Auto-retries when the browser reconnects.
 *
 * Pass `onBack` on views that hide the bottom nav so the user isn't trapped.
 */
export default function OfflineState({ onRetry, onBack }: { onRetry: () => void; onBack?: () => void }) {
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;

  useEffect(() => {
    const handler = () => retryRef.current();
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, []);

  return (
    <div className="relative min-h-[70vh]">
      {onBack && (
        <button onClick={onBack} className="absolute top-4 left-3 p-1.5 text-dark-400 hover:text-white">
          <ArrowLeft size={22} />
        </button>
      )}
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
        <div className="text-4xl mb-3">📡</div>
        <p className="text-dark-200 text-sm font-medium">Sin conexión</p>
        <p className="text-dark-500 text-xs mt-1 mb-5">
          Necesitás conexión para ver esta sección.
        </p>
        <button
          onClick={() => retryRef.current()}
          className="bg-brand-600 text-white text-sm font-semibold px-5 py-2.5 rounded-2xl active:bg-brand-500 transition-colors"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
