/**
 * currencyState.ts
 *
 * The app-wide "active currency" global, deliberately kept in its own tiny
 * module. It used to live in `utils.ts`, which also pulls in date-fns, the
 * Spanish locale and the icon registry — so `page.tsx` and `AppShell` importing
 * `setDefaultCurrency` dragged all of that onto the critical path. Nothing here
 * imports anything.
 *
 * The value is also mirrored to localStorage so a cold start can restore the
 * user's real currency synchronously, instead of rendering every amount in a
 * hardcoded default until the boot RPC answers and everything flips.
 */

const STORAGE_KEY = 'spendly-currency';

let _defaultCurrency: string = 'USD';

export function setDefaultCurrency(code: string) {
  _defaultCurrency = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Private mode / quota — the in-memory value still works for this session.
  }
}

export function getDefaultCurrency(): string {
  return _defaultCurrency;
}

/** Last known currency from a previous session, if any. Safe to call at boot. */
export function readCachedCurrency(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
