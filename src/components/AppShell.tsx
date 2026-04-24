'use client';

import { useState, lazy, Suspense } from 'react';
import { User } from '@supabase/supabase-js';
import { LayoutDashboard, Wallet, RefreshCcw, Settings, BarChart2 } from 'lucide-react';
import { setDefaultCurrency } from '@/lib/utils';
import { Budget } from '@/types';
import type { CurrencyCode } from '@/lib/currency';

const DashboardView = lazy(() => import('@/components/views/DashboardView'));
const CategoriesView = lazy(() => import('@/components/views/CategoriesView'));
const BudgetsView = lazy(() => import('@/components/views/BudgetsView'));
const BudgetDetailView = lazy(() => import('@/components/views/BudgetDetailView'));
const GlobalBudgetDetailView = lazy(() => import('@/components/views/GlobalBudgetDetailView'));
const RecurringView = lazy(() => import('@/components/views/RecurringView'));
const ReflectView = lazy(() => import('@/components/views/ReflectView'));
const SettingsView = lazy(() => import('@/components/views/SettingsView'));
const SpendingOverview = lazy(() => import('@/components/views/SpendingOverview'));

type Tab = 'dashboard' | 'categories' | 'budgets' | 'recurring' | 'settings' | 'overview' | 'budget-detail' | 'global-budget-detail' | 'reflect';

const tabs = [
  { id: 'dashboard' as Tab, label: 'Inicio', icon: LayoutDashboard },
  { id: 'budgets' as Tab, label: 'Budgets', icon: Wallet },
  { id: 'reflect' as Tab, label: 'Reflect', icon: BarChart2 },
  { id: 'recurring' as Tab, label: 'Fijos', icon: RefreshCcw },
  { id: 'settings' as Tab, label: 'Más', icon: Settings },
];

function DashboardSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-3 pt-5 animate-pulse">
      <div className="flex flex-col items-center mb-4">
        <div className="h-8 w-40 bg-dark-700 rounded-lg mb-2" />
        <div className="h-3 w-24 bg-dark-800 rounded" />
      </div>
      <div className="flex justify-center mb-4">
        <div className="h-7 w-40 bg-dark-800 rounded-full" />
      </div>
      <div className="h-32 bg-dark-800/50 rounded-xl mb-4" />
      {[1,2,3,4,5].map(i => (
        <div key={i} className="flex items-center gap-3 py-3 border-b border-dark-800/40">
          <div className="w-9 h-9 rounded-xl bg-dark-700 flex-shrink-0" />
          <div className="flex-1">
            <div className="h-3 w-28 bg-dark-700 rounded mb-1.5" />
            <div className="h-2 w-16 bg-dark-800 rounded" />
          </div>
          <div className="h-3 w-14 bg-dark-700 rounded" />
        </div>
      ))}
    </div>
  );
}

function ViewFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
    </div>
  );
}

interface AppShellProps {
  user: User;
  initialCurrency: CurrencyCode;
}

export default function AppShell({ user, initialCurrency }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [overviewDate, setOverviewDate] = useState<Date | undefined>(undefined);
  const [overviewViewMode, setOverviewViewMode] = useState<'months' | 'years' | undefined>(undefined);
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [defaultCurrency, _setDefaultCurrency] = useState<CurrencyCode>(initialCurrency);
  function updateCurrency(c: CurrencyCode) { _setDefaultCurrency(c); setDefaultCurrency(c); }

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

  // Called by DashboardView with optional date+viewMode when navigating to overview
  const handleNavigate = (tab: Tab, date?: Date, viewMode?: 'months' | 'years') => {
    if (tab === 'overview') {
      setOverviewDate(date);
      setOverviewViewMode(viewMode);
    }
    setActiveTab(tab);
  };

  const hideNav = activeTab === 'overview' || activeTab === 'budget-detail' || activeTab === 'global-budget-detail' || activeTab === 'categories';

  return (
    <div className="min-h-screen pb-20">
      <main className="page-transition">
        <Suspense fallback={activeTab === 'dashboard' ? <DashboardSkeleton /> : <ViewFallback />}>
          {activeTab === 'dashboard' && (
            <DashboardView user={user} onNavigate={handleNavigate} defaultCurrency={defaultCurrency} />
          )}
          {activeTab === 'categories' && <CategoriesView user={user} onBack={() => setActiveTab('settings')} />}
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
          {activeTab === 'reflect' && <ReflectView user={user} />}
          {activeTab === 'recurring' && <RecurringView user={user} />}
          {activeTab === 'settings' && (
            <SettingsView user={user} defaultCurrency={defaultCurrency} onCurrencyChange={updateCurrency} onOpenCategories={() => setActiveTab('categories')} />
          )}
          {activeTab === 'overview' && (
            <SpendingOverview
              user={user}
              onBack={() => setActiveTab('dashboard')}
              initialDate={overviewDate}
              initialViewMode={overviewViewMode}
            />
          )}
        </Suspense>
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
