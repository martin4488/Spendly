'use client';

import { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import { prefetchRates } from '@/lib/currency';
import { setDefaultCurrency, readCachedCurrency, DEFAULT_CURRENCY } from '@/lib/currencyState';
import { getCategories, seedCategories } from '@/lib/categoryCache';
import type { User } from '@supabase/auth-js';
import AppShell from '@/components/AppShell';
import type { CurrencyCode } from '@/lib/currency';
import { publishDashboardCache, readDashboardCache, buildCategoriesMapFromCache } from '@/lib/dashboardCache';
import { reportRpcFallback } from '@/lib/rpcFallback';
import type { Category } from '@/types';
import { toDateStr } from '@/lib/dateUtils';

// Lazy-load AuthPage — it's only shown when not logged in, which is rare.
// Keeps ~7 lucide icons + auth UI out of the critical bundle.
const AuthPage = lazy(() => import('@/app/auth/AuthPage'));

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The session lives in localStorage, which the server can't see, so the first
 * client render has to match the server's (the splash) or hydration fails. But
 * waiting for a passive effect to restore it would show that splash for a frame.
 * Layout effects run after hydration and *before* paint, so we get both: a
 * matching first render and a session restored in time for the first frame.
 *
 * The server never runs effects at all; aliasing to useEffect there just keeps
 * React from warning about useLayoutEffect during SSR.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface BootData {
  user: User;
  currency: CurrencyCode;
}

// Read cached session synchronously from localStorage — zero latency
function getCachedSession(): User | null {
  try {
    const raw = localStorage.getItem('spendly-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed?.currentSession ?? parsed;
    if (!session?.user || !session?.access_token) return null;
    if (session.expires_at && session.expires_at * 1000 < Date.now()) return null;
    return session.user as User;
  } catch {
    return null;
  }
}

// Throttle generate_recurring_expenses to once per day
function shouldRunRecurring(userId: string): boolean {
  try {
    const last = localStorage.getItem(`spendly_recurring_run_${userId}`);
    return !(last && new Date(last).toDateString() === new Date().toDateString());
  } catch {
    return true;
  }
}

/** Marca la corrida del día. Se llama recién cuando la RPC respondió bien: si
 *  falla (offline, por ejemplo) el próximo arranque tiene que reintentarla. */
function markRecurringRun(userId: string): void {
  try {
    localStorage.setItem(`spendly_recurring_run_${userId}`, new Date().toISOString());
  } catch {
    // Modo privado / sin cuota — corre de nuevo en el próximo arranque.
  }
}

/**
 * The currency to render with before the boot RPC answers. Using the value from
 * the last session avoids a cold start where every amount shows in a hardcoded
 * default and then flips once settings load.
 */
function initialCurrency(): CurrencyCode {
  const cached = readCachedCurrency();
  return (cached as CurrencyCode) || DEFAULT_CURRENCY;
}

export default function Home() {
  // Starts null so the first client render matches the server-rendered splash;
  // the layout effect below fills it in before the browser paints.
  const [bootData, setBootData] = useState<BootData | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  // A ref, not `!!bootData`: the auth effect below runs once on mount and would
  // otherwise capture the pre-restore value.
  const bootedRef = useRef(false);

  useIsomorphicLayoutEffect(() => {
    const cached = getCachedSession();
    if (!cached) return;
    const currency = initialCurrency();
    setDefaultCurrency(currency);
    setBootData({ user: cached, currency });
    bootedRef.current = true;
  }, []);

  useEffect(() => {
    // A restored session makes auth emit *two* events back to back — SIGNED_IN
    // then INITIAL_SESSION, both carrying the same session (pinned by
    // tests/supabase-contract.test.mjs). Without this guard every cold start
    // fired `get_boot_data` twice. Reset on sign-out so the next sign-in boots.
    let bootRunForUser: string | null = null;

    // Everything a boot has to *do* (as opposed to paint) lives here, because
    // this is the one path both cold starts share. It used to sit in
    // `bootWithSession` below the `bootedRef` guard — but the layout effect
    // above flips that ref for every returning user with a cached session, so
    // on the common path none of it ran: exchange rates were never fetched
    // (which made `convertCurrency` return null and every ARS/USD expense save
    // as the same number in the default currency) and recurring expenses were
    // never generated.
    function runUnifiedBootOnce(user: User) {
      if (bootRunForUser === user.id) return;
      bootRunForUser = user.id;

      runUnifiedBoot(user).catch(console.error);

      prefetchRates().catch(console.error);

      if (shouldRunRecurring(user.id)) {
        Promise.resolve(supabase.rpc('generate_recurring_expenses', { p_user_id: user.id }))
          .then(({ error }) => { if (!error) markRecurringRun(user.id); })
          .catch(console.error);
      }
    }

    function bootWithSession(user: User) {
      // Only the UI seeding is guarded: the layout effect may already have
      // painted from the cached session.
      if (!bootedRef.current) {
        bootedRef.current = true;

        const defaultCurr: CurrencyCode = initialCurrency();
        setDefaultCurrency(defaultCurr);
        setUnauthenticated(false);
        setBootData({ user, currency: defaultCurr });
      }

      runUnifiedBootOnce(user);
    }

    async function runUnifiedBoot(user: User) {
      const now = new Date();
      const start31 = new Date(now);
      start31.setDate(start31.getDate() - 30);
      const startStr = toDateStr(start31);

      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const chartStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;

      const { data: boot, error } = await supabase.rpc('get_boot_data', {
        p_user_id: user.id,
        p_recent_start: startStr,
        p_chart_start: chartStart,
      });

      if (!error && boot) {
        const currency = (boot.currency || DEFAULT_CURRENCY) as CurrencyCode;
        setDefaultCurrency(currency);
        setBootData(prev => prev ? { ...prev, currency } : null);

        const cats: Category[] = boot.categories || [];
        seedCategories(user.id, cats);

        const chartTotals: Record<string, number> = {};
        (boot.monthly_totals || []).forEach((row: { month: string; total: number }) => {
          chartTotals[row.month] = Number(row.total);
        });
        const categoriesMap = new Map<string, Category>();
        cats.forEach(c => categoriesMap.set(c.id, c));
        // Publish (not just write): DashboardView has already mounted off the old
        // cache by now, so it needs to be told the fresh data landed.
        publishDashboardCache(user.id, boot.recent_expenses || [], chartTotals, categoriesMap);
      } else {
        reportRpcFallback('get_boot_data', error, 'boot');
        // Boot RPC failed (e.g. offline). Seed categories from the localStorage
        // snapshot so the add-expense modal still works offline; only hit the
        // network for categories if we have no cache to fall back on.
        const snap = readDashboardCache(user.id);
        if (snap && snap.categories.length) {
          seedCategories(user.id, Array.from(buildCategoriesMapFromCache(snap.categories).values()));
        }
        await Promise.all([
          supabase.from('user_settings').select('default_currency').eq('user_id', user.id).single()
            .then(({ data: settings }) => {
              if (settings?.default_currency) {
                const currency = settings.default_currency as CurrencyCode;
                setDefaultCurrency(currency);
                setBootData(prev => prev ? { ...prev, currency } : null);
              }
            })
            .then(undefined, () => {}),
          (snap && snap.categories.length) ? Promise.resolve() : getCategories(user.id),
        ]);
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        if (session?.user) {
          bootWithSession(session.user);
        } else if (event === 'INITIAL_SESSION') {
          setUnauthenticated(true);
        }
      } else if (event === 'SIGNED_OUT') {
        bootedRef.current = false;
        bootRunForUser = null;
        setBootData(null);
        setUnauthenticated(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!bootData && !unauthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">💸</div>
          <div className="text-lg font-semibold text-brand-400">Spendly</div>
        </div>
      </div>
    );
  }

  if (unauthenticated || !bootData) {
    return (
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-3">💸</div>
            <div className="text-lg font-semibold text-brand-400">Spendly</div>
          </div>
        </div>
      }>
        <AuthPage />
      </Suspense>
    );
  }

  return <AppShell user={bootData.user} initialCurrency={bootData.currency} />;
}
