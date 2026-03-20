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

export default function Home() {
  const [bootData, setBootData] = useState<BootData | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);

  useEffect(() => {
    // Track if we've already booted to avoid double-boot from INITIAL_SESSION + SIGNED_IN
    let booted = false;

    async function bootWithSession(user: User) {
      if (booted) return;
      booted = true;

      // Show app immediately with default currency — don't wait for settings
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
          // No session cached — show login immediately
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
