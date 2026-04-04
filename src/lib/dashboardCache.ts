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

import { Expense, Category } from '@/types';

const CACHE_KEY = 'spendly_dashboard_cache';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — stale but still useful for instant display

export interface DashboardSnapshot {
  expenses: Expense[];
  chartTotals: Record<string, number>;
  categories: Array<{ id: string; name: string; icon: string; color: string; parent_id: string | null }>;
  timestamp: number;
  userId: string;
}

/** Read cached dashboard data. Returns null if missing, expired, or wrong user. */
export function readDashboardCache(userId: string): DashboardSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: DashboardSnapshot = JSON.parse(raw);
    if (parsed.userId !== userId) return null;
    if (Date.now() - parsed.timestamp > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Write dashboard data to cache. */
export function writeDashboardCache(
  userId: string,
  expenses: Expense[],
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
