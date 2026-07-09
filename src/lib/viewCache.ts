/**
 * viewCache.ts
 *
 * Generic stale-while-revalidate cache for secondary views (Budgets, Reflect,
 * Recurring). Same idea as dashboardCache but keyed per view, so any tab can
 * render its last snapshot from localStorage *instantly* (no spinner) while a
 * fresh fetch runs in the background.
 *
 * Flow per view:
 * 1. On mount, read the snapshot → render immediately, skip the spinner.
 * 2. In parallel, refetch from Supabase.
 * 3. When fresh data arrives, replace state and rewrite the snapshot.
 *
 * The boot warm-up (AppShell) also primes these caches during idle time so even
 * the very first visit of the app's life is instant.
 */

const PREFIX = 'spendly_view_cache_';

interface Envelope<T> {
  userId: string;
  data: T;
  timestamp: number;
}

/** Read a view snapshot. Returns null if missing, wrong user, or corrupt. */
export function readViewCache<T>(key: string, userId: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed: Envelope<T> = JSON.parse(raw);
    if (parsed.userId !== userId) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Write a view snapshot. Silently ignores quota/serialization errors. */
export function writeViewCache<T>(key: string, userId: string, data: T): void {
  try {
    const env: Envelope<T> = { userId, data, timestamp: Date.now() };
    localStorage.setItem(PREFIX + key, JSON.stringify(env));
  } catch {
    // localStorage full or unavailable — a missing cache just means a spinner.
  }
}

/** Clear every view cache (e.g. on sign out, so the next user sees nothing stale). */
export function clearViewCaches(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch {}
}
