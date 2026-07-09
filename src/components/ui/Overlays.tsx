'use client';

import { useEffect, useState, useCallback } from 'react';
import { onToast, type ToastItem } from '@/lib/toast';
import { setConfirmListener, type ConfirmRequest } from '@/lib/confirm';

const TOAST_TTL = 3500;

const TOAST_STYLES: Record<ToastItem['type'], string> = {
  error: 'bg-red-500/95 text-white',
  success: 'bg-brand-600/95 text-white',
  info: 'bg-dark-700/95 text-white',
};

/**
 * Global overlay host: renders transient toasts (see lib/toast.ts) and the
 * promise-based confirmation dialog (see lib/confirm.ts). Mounted once in the
 * root layout so any code — including non-React modules — can trigger them.
 */
export default function Overlays() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);

  // ── Toasts ──────────────────────────────────────────────────────────────
  useEffect(() => {
    return onToast((t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, TOAST_TTL);
    });
  }, []);

  // ── Confirm ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setConfirmListener((req) => setConfirmReq(req));
    return () => setConfirmListener(null);
  }, []);

  const resolveConfirm = useCallback((value: boolean) => {
    setConfirmReq((req) => {
      req?.resolve(value);
      return null;
    });
  }, []);

  return (
    <>
      {/* Toasts */}
      <div className="fixed inset-x-0 bottom-24 z-[200] flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`slide-up pointer-events-auto max-w-sm w-full text-center text-sm font-medium px-4 py-3 rounded-2xl shadow-xl shadow-black/30 backdrop-blur-sm ${TOAST_STYLES[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmReq && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 px-6"
          onClick={() => resolveConfirm(false)}
        >
          <div
            className="w-full max-w-xs bg-dark-900 border border-dark-700 rounded-2xl p-5 slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-dark-100 leading-relaxed mb-5">{confirmReq.message}</p>
            <div className="flex gap-2.5">
              <button
                onClick={() => resolveConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-dark-300 bg-dark-800 active:bg-dark-700 transition-colors"
              >
                {confirmReq.cancelLabel || 'Cancelar'}
              </button>
              <button
                onClick={() => resolveConfirm(true)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-colors ${
                  confirmReq.danger === false
                    ? 'bg-brand-600 active:bg-brand-500'
                    : 'bg-red-500 active:bg-red-600'
                }`}
              >
                {confirmReq.confirmLabel || 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
