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

  // Miss or different user: start fresh fetch
  const fetchPromise: Promise<Map<string, Category>> = supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('position')
    .order('created_at')
    .then(({ data }) => {
      const list: Category[] = data || [];
      const map = new Map<string, Category>();
      list.forEach(c => map.set(c.id, c));
      cache = { userId, map, list, promise: null };
      return map;
    });

  cache = { userId, map: new Map(), list: [], promise: fetchPromise };
  return fetchPromise;
}

/** Returns the flat list version (for pickers, selects, etc.) */
export async function getCategoriesList(userId: string): Promise<Category[]> {
  await getCategories(userId);
  return cache?.list || [];
}

/** Returns the map synchronously if already cached, null otherwise. */
export function getCategoriesSync(userId: string): Map<string, Category> | null {
  if (cache && cache.userId === userId && !cache.promise) {
    return cache.map;
  }
  return null;
}

/** Call this after any create/edit/delete on categories. */
export function invalidateCategories() {
  cache = null;
}
