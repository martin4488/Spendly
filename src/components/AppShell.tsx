'use client';

import { useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { LayoutDashboard, FolderTree, Wallet, RefreshCcw, Settings } from 'lucide-react';
import { setDefaultCurrency } from '@/lib/utils';
import { Budget } from '@/types';
import DashboardView from '@/components/views/DashboardView';
import CategoriesView from '@/components/views/CategoriesView';
import BudgetsView from '@/components/views/BudgetsView';
import BudgetDetailView from '@/components/views/BudgetDetailView';
import GlobalBudgetDetailView from '@/components/views/GlobalBudgetDetailView';
import RecurringView from '@/components/views/RecurringView';
import SettingsView from '@/components/views/SettingsView';
import SpendingOverview from '@/components/views/SpendingOverview';
import type { CurrencyCode } from '@/lib/currency';

type Tab = 'dashboard' | 'categories' | 'budgets' | 'recurring' | 'settings' | 'overview' | 'budget-detail' | 'global-budget-detail';

const tabs = [
  { id: 'dashboard' as Tab, label: 'Inicio', icon: LayoutDashboard },
  { id: 'budgets' as Tab, label: 'Budgets', icon: Wallet },
  { id: 'categories' as Tab, label: 'Categorías', icon: FolderTree },
  { id: 'recurring' as Tab, label: 'Fijos', icon: RefreshCcw },
  { id: 'settings' as Tab, label: 'Más', icon: Settings },
];

interface AppShellProps {
  user: User;
  initialCurrency: CurrencyCode;
}

export default function AppShell({ user, initialCurrency }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [defaultCurrency, _setDefaultCurrency] = useState<CurrencyCode>(initialCurrency);
  function updateCurrency(c: CurrencyCode) { _setDefaultCurrency(c); setDefaultCurrency(c); }

  // No loading state needed — currency is passed in from page.tsx boot

  const openBudget = (budget: Budget, periodId: string = '') => {
    setSelectedBudget(budget);
    setSelectedPeriodId(periodId);
    setActiveTab('budget-detail');
  };

  const backFromBudgetDetail = () => {
    setSelectedBudget(null);
    setSelectedPeriodId('');
    setActiveTab('budgets');
  };

  const hideNav = activeTab === 'overview' || activeTab === 'budget-detail' || activeTab === 'global-budget-detail';

  return (
    <div className="min-h-screen pb-20">
      <main className="page-transition">
        {activeTab === 'dashboard' && (
          <DashboardView user={user} onNavigate={setActiveTab} defaultCurrency={defaultCurrency} />
        )}
        {activeTab === 'categories' && <CategoriesView user={user} />}
        {activeTab === 'budgets' && <BudgetsView user={user} onOpenBudget={openBudget} onOpenGlobalBudget={() => setActiveTab('global-budget-detail')} />}
        {activeTab === 'budget-detail' && selectedBudget && (
          <BudgetDetailView
            user={user}
            budget={selectedBudget}
            initialPeriodId={selectedPeriodId}
            onBack={backFromBudgetDetail}
            onRefresh={() => {
              setActiveTab('budgets');
              setTimeout(() => setActiveTab('budget-detail'), 50);
            }}
          />
        )}
        {activeTab === 'global-budget-detail' && (
          <GlobalBudgetDetailView
            user={user}
            onBack={() => setActiveTab('budgets')}
            defaultCurrency={defaultCurrency}
          />
        )}
        {activeTab === 'recurring' && <RecurringView user={user} />}
        {activeTab === 'settings' && (
          <SettingsView user={user} defaultCurrency={defaultCurrency} onCurrencyChange={updateCurrency} />
        )}
        {activeTab === 'overview' && (
          <SpendingOverview user={user} onBack={() => setActiveTab('dashboard')} />
        )}
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
                  className={`flex flex-col items-center py-2.5 px-3 min-w-[60px] transition-all ${isActive ? 'text-brand-400' : 'text-dark-500'}`}
                >
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
                  <span className={`text-[10px] mt-1 ${isActive ? 'font-semibold' : 'font-medium'}`}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
