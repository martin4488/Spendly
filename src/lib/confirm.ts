/**
 * confirm.ts
 *
 * Promise-based confirmation dialog to replace the native, out-of-place
 * `window.confirm()`. Call `await confirmDialog('¿Seguro?')` and it resolves to
 * true/false. A single <Overlays /> mounted in the layout renders the dialog.
 * Falls back to native confirm if no renderer is mounted (e.g. before hydration).
 */

export interface ConfirmOptions {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (value: boolean) => void;
}

type Listener = (req: ConfirmRequest) => void;

let listener: Listener | null = null;
let counter = 0;

/** Registered by <Overlays />. Only one renderer at a time. */
export function setConfirmListener(fn: Listener | null): void {
  listener = fn;
}

export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const options: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
  return new Promise((resolve) => {
    if (!listener) {
      // No renderer mounted — degrade to native confirm.
      resolve(typeof window !== 'undefined' ? window.confirm(options.message) : false);
      return;
    }
    listener({ ...options, id: ++counter, resolve });
  });
}
