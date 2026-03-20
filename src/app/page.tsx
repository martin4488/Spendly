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
    async function bootWithSession(user: User) {
      // Fire recurring generation without blocking render
      Promise.resolve(supabase.rpc('generate_recurring_expenses', { p_user_id: user.id })).catch(console.error);

      // Load settings — use default if missing
      let currency: CurrencyCode = 'EUR';
      const { data: settings } = await supabase
        .from('user_settings')
        .select('default_currency')
        .eq('user_id', user.id)
        .single();

      if (settings) {
        currency = settings.default_currency as CurrencyCode;
      } else {
        supabase.from('user_settings').insert({ user_id: user.id, default_currency: 'EUR' }).then(() => {});
      }

      setDefaultCurrency(currency);
      setUnauthenticated(false);
      setBootData({ user, currency });
    }

    async function boot() {
      const [{ data: { session } }] = await Promise.all([
        supabase.auth.getSession(),
        prefetchRates(),
      ]);

      if (!session?.user) {
        setUnauthenticated(true);
        return;
      }

      await bootWithSession(session.user);
    }

    boot();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setBootData(null);
        setUnauthenticated(true);
      } else if (event === 'SIGNED_IN' && session?.user) {
        bootWithSession(session.user);
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
