'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { prefetchRates } from '@/lib/currency';
import { setDefaultCurrency } from '@/lib/utils';
import { getCategories, seedCategories } from '@/lib/categoryCache';
import { User } from '@supabase/supabase-js';
import AuthPage from '@/app/auth/AuthPage';
import AppShell from '@/components/AppShell';
import type { CurrencyCode } from '@/lib/currency';
import { writeDashboardCache } from '@/lib/dashboardCache';
import type { Category } from '@/types';

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
    const key = `spendly_recurring_run_${userId}`;
    const last = localStorage.getItem(key);
    if (last && new Date(last).toDateString() === new Date().toDateString()) return false;
    localStorage.setItem(key, new Date().toISOString());
    return true;
  } catch {
    return true;
  }
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Home() {
  const [bootData, setBootData] = useState<BootData | null>(() => {
    if (typeof window === 'undefined') return null;
    const cached = getCachedSession();
    if (!cached) return null;
    setDefaultCurrency('EUR');
    return { user: cached, currency: 'EUR' };
  });
  const [unauthenticated, setUnauthenticated] = useState(false);

  useEffect(() => {
    let booted = !!bootData;

    async function bootWithSession(user: User) {
      if (booted) {
        // App already visible from cache — run unified boot in background
        runUnifiedBoot(user).catch(console.error);
        return;
      }
      booted = true;

      const defaultCurr: CurrencyCode = 'EUR';
      setDefaultCurrency(defaultCurr);
      setUnauthenticated(false);
      setBootData({ user, currency: defaultCurr });

      // Run unified boot — single RPC replaces settings + categories + dashboard data
      runUnifiedBoot(user).catch(console.error);

      // Fire-and-forget background tasks
      prefetchRates().catch(console.error);

      if (shouldRunRecurring(user.id)) {
        Promise.resolve(supabase.rpc('generate_recurring_expenses', { p_user_id: user.id })).catch(console.error);
      }
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
        // 1. Currency
        const currency = (boot.currency || 'EUR') as CurrencyCode;
        setDefaultCurrency(currency);
        setBootData(prev => prev ? { ...prev, currency } : null);

        // 2. Seed category cache from RPC result (avoids separate fetch)
        const cats: Category[] = boot.categories || [];
        seedCategories(user.id, cats);

        // 3. Pre-populate dashboard cache so DashboardView has instant data
        const chartTotals: Record<string, number> = {};
        (boot.monthly_totals || []).forEach((row: { month: string; total: number }) => {
          chartTotals[row.month] = Number(row.total);
        });
        const categoriesMap = new Map<string, Category>();
        cats.forEach(c => categoriesMap.set(c.id, c));
        writeDashboardCache(user.id, boot.recent_expenses || [], chartTotals, categoriesMap);
      } else {
        // Fallback: original separate queries
        const [, catsMap] = await Promise.all([
          supabase.from('user_settings').select('default_currency').eq('user_id', user.id).single()
            .then(({ data: settings }) => {
              if (settings?.default_currency) {
                const currency = settings.default_currency as CurrencyCode;
                setDefaultCurrency(currency);
                setBootData(prev => prev ? { ...prev, currency } : null);
              }
            }),
          getCategories(user.id),
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
        booted = false;
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
    return <AuthPage />;
  }

  return <AppShell user={bootData.user} initialCurrency={bootData.currency} />;
}
