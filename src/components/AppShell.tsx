'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { prefetchRates } from '@/lib/currency';
import { LayoutDashboard, FolderTree, Wallet, RefreshCcw, Settings } from 'lucide-react';
import { Budget } from '@/types';
import DashboardView from '@/components/views/DashboardView';
import CategoriesView from '@/components/views/CategoriesView';
import BudgetsView from '@/components/views/BudgetsView';
import BudgetDetailView from '@/components/views/BudgetDetailView';
import RecurringView from '@/components/views/RecurringView';
import SettingsView from '@/components/views/SettingsView';
import SpendingOverview from '@/components/views/SpendingOverview';
import type { CurrencyCode } from '@/lib/currency';

type Tab = 'dashboard' | 'categories' | 'budgets' | 'recurring' | 'settings' | 'overview' | 'budget-detail';

const tabs: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
  { id: 'budgets', label: 'Budgets', icon: Wallet },
  { id: 'categories', label: 'Categorías', icon: FolderTree },
  { id: 'recurring', label: 'Fijos', icon: RefreshCcw },
  { id: 'settings', label: 'Más', icon: Settings },
];

export default function AppShell({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);
  const [defaultCurrency, setDefaultCurrency] = useState<CurrencyCode>('EUR');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load user settings + prefetch exchange rates on mount
  useEffect(() => {
    async function init() {
      // Prefetch rates in parallel with settings load
      const [_, { data }] = await Promise.all([
        prefetchRates(),
        supabase.from('user_settings').select('*').eq('user_id', user.id).single(),
      ]);

      if (data) {
        setDefaultCurrency(data.default_currency as CurrencyCode);
      } else {
        // Create default settings
        await supabase.from('user_settings').insert({
          user_id: user.id,
          default_currency: 'EUR',
        });
      }
      setSettingsLoaded(true);
    }
    init();
  }, [user.id]);

  function openBudget(budget: Budget) {
    setSelectedBudget(budget);
    setActiveTab('budget-detail');
  }

  function backFromBudgetDetail() {
    setSelectedBudget(null);
    setActiveTab('budgets');
  }

  function handleCurrencyChange(currency: CurrencyCode) {
    setDefaultCurrency(currency);
  }

  const hideNav = activeTab === 'overview' || activeTab === 'budget-detail';

  if (!settingsLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">💸</div>
          <div className="text-lg font-semibold text-brand-400">Spendly</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <main className="page-transition">
        {activeTab === 'dashboard' && <DashboardView user={user} onNavigate={setActiveTab} defaultCurrency={defaultCurrency} />}
        {activeTab === 'categories' && <CategoriesView user={user} />}
        {activeTab === 'budgets' && <BudgetsView user={user} onOpenBudget={openBudget} />}
        {activeTab === 'budget-detail' && selectedBudget && (
          <BudgetDetailView
            user={user}
            budget={selectedBudget}
            onBack={backFromBudgetDetail}
            onRefresh={() => {
              setActiveTab('budgets');
              setTimeout(() => setActiveTab('budget-detail'), 50);
            }}
          />
        )}
        {activeTab === 'recurring' && <RecurringView user={user} />}
        {activeTab === 'settings' && (
          <SettingsView
            user={user}
            defaultCurrency={defaultCurrency}
            onCurrencyChange={handleCurrencyChange}
          />
        )}
        {activeTab === 'overview' && <SpendingOverview user={user} onBack={() => setActiveTab('dashboard')} />}
      </main>

      {!hideNav && (
        <nav className="fixed bottom-0 left-0 right-0 bg-dark-900/95 backdrop-blur-xl border-t border-dark-700/50 z-50">
          <div className="flex items-center justify-around max-w-lg mx-auto px-2 pb-[env(safe-area-inset-bottom)]">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex flex-col items-center py-2.5 px-3 min-w-[60px] transition-all ${
                    isActive ? 'text-brand-400' : 'text-dark-500'
                  }`}
                >
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
                  <span className={`text-[10px] mt-1 ${isActive ? 'font-semibold' : 'font-medium'}`}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
