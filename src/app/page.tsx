'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { prefetchRates } from '@/lib/currency';
import { setDefaultCurrency } from '@/lib/utils';
import { User } from '@supabase/supabase-js';
import AuthPage from '@/app/auth/AuthPage';
import AppShell from '@/components/AppShell';
import type { CurrencyCode } from '@/lib/currency';

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
    // Supabase stores session under the key directly
    const session = parsed?.currentSession ?? parsed;
    if (!session?.user || !session?.access_token) return null;
    // Check expiry
    if (session.expires_at && session.expires_at * 1000 < Date.now()) return null;
    return session.user as User;
  } catch {
    return null;
  }
}

export default function Home() {
  // Try to boot instantly from cache — avoids blank screen while Supabase initializes
  const [bootData, setBootData] = useState<BootData | null>(() => {
    if (typeof window === 'undefined') return null;
    const cached = getCachedSession();
    if (!cached) return null;
    setDefaultCurrency('EUR');
    return { user: cached, currency: 'EUR' };
  });
  const [unauthenticated, setUnauthenticated] = useState(false);

  useEffect(() => {
    let booted = !!bootData; // already booted from cache

    async function bootWithSession(user: User) {
      if (booted) {
        // Already showing app — just update currency in background
        supabase.from('user_settings').select('default_currency').eq('user_id', user.id).single()
          .then(({ data: settings }) => {
            if (settings?.default_currency) {
              const currency = settings.default_currency as CurrencyCode;
              setDefaultCurrency(currency);
              setBootData(prev => prev ? { ...prev, currency } : null);
            }
          });
        return;
      }
      booted = true;

      const defaultCurr: CurrencyCode = 'EUR';
      setDefaultCurrency(defaultCurr);
      setUnauthenticated(false);
      setBootData({ user, currency: defaultCurr });

      // Load real settings + prefetch rates in background (non-blocking)
      Promise.resolve(supabase.rpc('generate_recurring_expenses', { p_user_id: user.id })).catch(console.error);
      prefetchRates().catch(console.error);

      supabase.from('user_settings').select('default_currency').eq('user_id', user.id).single()
        .then(({ data: settings }) => {
          if (settings?.default_currency && settings.default_currency !== defaultCurr) {
            const currency = settings.default_currency as CurrencyCode;
            setDefaultCurrency(currency);
            setBootData(prev => prev ? { ...prev, currency } : null);
          } else if (!settings) {
            supabase.from('user_settings').insert({ user_id: user.id, default_currency: 'EUR' }).then(() => {});
          }
        });
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
