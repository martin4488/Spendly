/**
 * dashboardCache.ts
 *
 * Caches the dashboard snapshot (expenses + chart totals + categories)
 * in localStorage so cold starts show data instantly while fresh data
 * loads in the background.
 *
 * Flow:
 * 1. On mount, DashboardView reads cached data → renders immediately (no spinner)
 * 2. In parallel, loadDashboard() fetches fresh data from Supabase
 * 3. When fresh data arrives, it replaces the stale data and updates the cache
 */

import { ExpenseListItem, Category } from '@/types';

const CACHE_KEY = 'spendly_dashboard_cache';
// No expiration — cache is overwritten with fresh data every time the app opens.
// Stale data (even weeks old) is always better than a spinner for half a second.

export interface DashboardSnapshot {
  expenses: ExpenseListItem[];
  chartTotals: Record<string, number>;
  categories: Array<{ id: string; name: string; icon: string; color: string; parent_id: string | null }>;
  timestamp: number;
  userId: string;
}

/** Read cached dashboard data. Returns null if missing or wrong user. */
export function readDashboardCache(userId: string): DashboardSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: DashboardSnapshot = JSON.parse(raw);
    if (parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Write dashboard data to cache. */
export function writeDashboardCache(
  userId: string,
  expenses: ExpenseListItem[],
  chartTotals: Record<string, number>,
  categoriesMap: Map<string, Category>,
): void {
  try {
    // Only cache minimal category fields to keep payload small
    const categories = Array.from(categoriesMap.values()).map(c => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      parent_id: c.parent_id,
    }));

    const snapshot: DashboardSnapshot = {
      expenses,
      chartTotals,
      categories,
      timestamp: Date.now(),
      userId,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

// ── Fresh-snapshot subscribers ───────────────────────────────────────────────
// The boot RPC in `page.tsx` finishes *after* DashboardView has already mounted
// and seeded itself from the cache, so without this the freshly fetched data sat
// in localStorage until the next launch and the user stared at last session's
// numbers. Boot publishes through `publishDashboardCache`; the view subscribes
// and adopts the snapshot when it's safe to (see DashboardView).

type SnapshotListener = (snapshot: DashboardSnapshot) => void;
const listeners = new Set<SnapshotListener>();

/** Subscribe to snapshots published by a *different* writer. Returns unsubscribe. */
export function onDashboardSnapshot(fn: SnapshotListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Write the cache and notify subscribers. Used by the boot path; ordinary view
 * refreshes call `writeDashboardCache` instead, since they already hold the data
 * in state and re-broadcasting it would just cause a redundant render.
 */
export function publishDashboardCache(
  userId: string,
  expenses: ExpenseListItem[],
  chartTotals: Record<string, number>,
  categoriesMap: Map<string, Category>,
): void {
  writeDashboardCache(userId, expenses, chartTotals, categoriesMap);
  const snapshot = readDashboardCache(userId);
  if (!snapshot) return;
  listeners.forEach(fn => {
    try { fn(snapshot); } catch { /* a bad subscriber must not break the boot */ }
  });
}

/** Clear cache (e.g. on sign out). */
export function clearDashboardCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}

/** Build a Map<id, Category> from cached minimal category data. */
export function buildCategoriesMapFromCache(
  cats: DashboardSnapshot['categories']
): Map<string, Category> {
  const map = new Map<string, Category>();
  cats.forEach(c => {
    map.set(c.id, {
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      parent_id: c.parent_id,
      user_id: '',
      hidden: false,
      created_at: '',
      updated_at: '',
    } as Category);
  });
  return map;
}
