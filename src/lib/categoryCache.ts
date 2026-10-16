/**
 * categoryCache.ts
 *
 * In-memory singleton cache for categories.
 * - Fetches once per user session, then serves instantly from memory.
 * - Any view that mutates categories (create/edit/delete) calls invalidate()
 *   so the next read re-fetches fresh data.
 * - All reads return a Map<id, Category> for O(1) lookup.
 */

import { supabase } from '@/lib/supabase';
import { Category } from '@/types';

interface CacheEntry {
  userId: string;
  map: Map<string, Category>;
  list: Category[];
  promise: Promise<Map<string, Category>> | null;
}

let cache: CacheEntry | null = null;

// Last known-good list, kept across `invalidateCategories()` and primed from the
// localStorage snapshot at boot. Only `getCategoriesSync` reads it: the
// add-expense picker used to open empty and wait on the network whenever the
// in-memory cache was cold — on every cold start until `get_boot_data`
// answered, and after any edit in Categorías. Showing the previous list and
// swapping in the fresh one is always better than an empty picker.
let stale: { userId: string; map: Map<string, Category> } | null = null;

type Listener = (userId: string, map: Map<string, Category>) => void;
const listeners = new Set<Listener>();

/** Notified whenever fresh categories land (fetch or seed). Returns unsubscribe. */
export function onCategoriesChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function store(userId: string, list: Category[]): Map<string, Category> {
  const map = new Map<string, Category>();
  list.forEach(c => map.set(c.id, c));
  cache = { userId, map, list, promise: null };
  stale = null;
  listeners.forEach(fn => { try { fn(userId, map); } catch { /* ignore */ } });
  return map;
}

/** Fetch and cache categories for a user. Returns Map<id, Category>. */
export async function getCategories(userId: string): Promise<Map<string, Category>> {
  // Hit: same user, data already loaded
  if (cache && cache.userId === userId && !cache.promise) {
    return cache.map;
  }

  // In-flight: another call already fetching — reuse the same promise
  if (cache && cache.userId === userId && cache.promise) {
    return cache.promise;
  }

  // Miss or different user: start fresh fetch.
  const fetchPromise: Promise<Map<string, Category>> = Promise.resolve(
    supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .neq('deleted', true)
      .order('position')
      .order('created_at')
  ).then(({ data, error }) => {
      // Ojo: un error (offline, timeout, 500) llega como `{ data: null, error }`,
      // no como excepción. `data || []` lo guardaba como un mapa vacío marcado
      // como válido para toda la sesión: el dashboard mostraba "Sin categoría"
      // en cada fila y el modal de gastos no ofrecía ninguna, aun después de
      // reconectar. Sólo se cachea el éxito — el fallo deja el cache vacío para
      // que el próximo llamado reintente.
      if (error || !data) {
        cache = null;
        return new Map<string, Category>();
      }
      return store(userId, data as Category[]);
    })
    .catch(() => {
      cache = null;
      return new Map<string, Category>();
    });

  cache = { userId, map: new Map(), list: [], promise: fetchPromise };
  return fetchPromise;
}

/** Returns the flat list version (for pickers, selects, etc.) */
export async function getCategoriesList(userId: string): Promise<Category[]> {
  await getCategories(userId);
  return cache?.list || [];
}

/**
 * Returns the map synchronously if cached — or, failing that, the last
 * known-good list for this user (see `stale`) — null otherwise.
 */
export function getCategoriesSync(userId: string): Map<string, Category> | null {
  if (cache && cache.userId === userId && !cache.promise) {
    return cache.map;
  }
  if (stale && stale.userId === userId) return stale.map;
  return null;
}

/**
 * Prime the sync read with a possibly-old list (the localStorage snapshot) so
 * the UI has something to paint before the network answers. Unlike
 * `seedCategories` it does *not* mark the cache valid: `getCategories` still
 * fetches. No-op if real data is already there.
 */
export function primeCategories(userId: string, list: Category[]): void {
  if (getCategoriesSync(userId) || list.length === 0) return;
  const map = new Map<string, Category>();
  list.forEach(c => map.set(c.id, c));
  stale = { userId, map };
}

/**
 * Seed the cache with data from an external source (e.g. boot RPC).
 * Avoids a separate fetch when categories are already available.
 */
export function seedCategories(userId: string, list: Category[]): void {
  store(userId, list);
}

/**
 * Call this after any create/edit/delete on categories. The previous list stays
 * readable through `getCategoriesSync` until the refetch lands.
 */
export function invalidateCategories() {
  if (cache && !cache.promise) stale = { userId: cache.userId, map: cache.map };
  cache = null;
}

/** Drop everything, stale copy included (sign-out). */
export function clearCategories() {
  cache = null;
  stale = null;
}
