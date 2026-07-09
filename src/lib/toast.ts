/**
 * toast.ts
 *
 * Tiny dependency-free toast bus. Call `toast('mensaje')` from anywhere (even
 * outside React) to show a transient message; a single <Overlays /> mounted in
 * the layout renders them. Defaults to an error toast since that's the common case.
 */

export type ToastType = 'error' | 'success' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

type Listener = (t: ToastItem) => void;

const listeners = new Set<Listener>();
let counter = 0;

export function onToast(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function toast(message: string, type: ToastType = 'error'): void {
  const item: ToastItem = { id: ++counter, message, type };
  listeners.forEach((l) => l(item));
}
