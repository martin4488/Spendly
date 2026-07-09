'use client';

import { useState, lazy, Suspense, useCallback, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { LayoutDashboard, Wallet, RefreshCcw, Settings, BarChart2 } from 'lucide-react';
import { setDefaultCurrency } from '@/lib/utils';
import { Budget } from '@/types';
import type { CurrencyCode } from '@/lib/currency';
import ChunkErrorBoundary from '@/components/ChunkErrorBoundary';
// Dashboard is the first view rendered on every cold start, so it ships in the
// main bundle (not lazy) — lazy-loading it would add a chunk round-trip on the
// critical path before the first paint.
import DashboardView from '@/components/views/DashboardView';
import DashboardSkeleton from '@/components/ui/DashboardSkeleton';

// Shared import factories so we can both lazy-render and prefetch the same chunks.
const imports = {
  categories: () => import('@/components/views/CategoriesView'),
  budgets: () => import('@/components/views/BudgetsView'),
  budgetDetail: () => import('@/components/views/BudgetDetailView'),
  globalBudgetDetail: () => import('@/components/views/GlobalBudgetDetailView'),
  recurring: () => import('@/components/views/RecurringView'),
  reflect: () => import('@/components/views/ReflectView'),
  settings: () => import('@/components/views/SettingsView'),
  overview: () => import('@/components/views/SpendingOverview'),
  addExpense: () => import('@/components/AddExpenseModal'),
};

const CategoriesView = lazy(imports.categories);
const BudgetsView = lazy(imports.budgets);
const BudgetDetailView = lazy(imports.budgetDetail);
const GlobalBudgetDetailView = lazy(imports.globalBudgetDetail);
const RecurringView = lazy(imports.recurring);
const ReflectView = lazy(imports.reflect);
const SettingsView = lazy(imports.settings);
const SpendingOverview = lazy(imports.overview);

type Tab = 'dashboard' | 'categories' | 'budgets' | 'recurring' | 'settings' | 'overview' | 'budget-detail' | 'global-budget-detail' | 'reflect';

const tabs = [
  { id: 'dashboard' as Tab, label: 'Inicio', icon: LayoutDashboard },
  { id: 'budgets' as Tab, label: 'Budgets', icon: Wallet },
  { id: 'reflect' as Tab, label: 'Reflect', icon: BarChart2 },
  { id: 'recurring' as Tab, label: 'Fijos', icon: RefreshCcw },
  { id: 'settings' as Tab, label: 'Más', icon: Settings },
];

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
  // Bumped to force a fresh BudgetDetailView mount after a save (replaces the old setTimeout hack)
  const [budgetDetailKey, setBudgetDetailKey] = useState(0);

  const updateCurrency = useCallback((c: CurrencyCode) => {
    _setDefaultCurrency(c);
    setDefaultCurrency(c);
  }, []);

  // Warm the lazy chunks while idle & online so every view — especially the
  // add-expense modal — is cached by the service worker and works offline.
  // Without this, opening a not-yet-visited view offline fails the dynamic
  // import and crashes with a client-side error.
  useEffect(() => {
    let done = false;
    const warm = () => {
      if (done) return;
      done = true;
      // Warm every chunk (so all views work offline) and, for the heaviest tabs,
      // prime their data snapshot too so even the first visit is instant.
      const prefetchers: Record<string, string> = {
        recurring: 'prefetchRecurring',
        reflect: 'prefetchReflect',
        budgets: 'prefetchBudgets',
      };
      Object.entries(imports).forEach(([name, load]) => {
        load().then((m: Record<string, unknown>) => {
          const fn = prefetchers[name];
          if (fn && typeof m[fn] === 'function') (m[fn] as (id: string) => void)(user.id);
        }).catch(() => {});
      });
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 2000);
  }, []);

  const openBudget = useCallback((budget: Budget, periodId: string = '') => {
    setSelectedBudget(budget);
    setSelectedPeriodId(periodId);
    setActiveTab('budget-detail');
  }, []);

  const backFromBudgetDetail = useCallback(() => {
    setSelectedBudget(null);
    setSelectedPeriodId('');
    setActiveTab('budgets');
  }, []);

  // Called by DashboardView with optional date+viewMode when navigating to overview
  const handleNavigate = useCallback((tab: Tab, date?: Date, viewMode?: 'months' | 'years') => {
    if (tab === 'overview') {
      setOverviewDate(date);
      setOverviewViewMode(viewMode);
    }
    setActiveTab(tab);
  }, []);

  const hideNav = activeTab === 'overview' || activeTab === 'budget-detail' || activeTab === 'global-budget-detail' || activeTab === 'categories';

  return (
    <div className="min-h-screen pb-20">
      <main className="page-transition">
        <ChunkErrorBoundary key={activeTab}>
        <Suspense fallback={activeTab === 'dashboard' ? <DashboardSkeleton /> : <ViewFallback />}>
          {activeTab === 'dashboard' && (
            <DashboardView user={user} onNavigate={handleNavigate} defaultCurrency={defaultCurrency} />
          )}
          {activeTab === 'categories' && <CategoriesView user={user} onBack={() => setActiveTab('settings')} />}
          {activeTab === 'budgets' && <BudgetsView user={user} onOpenBudget={openBudget} onOpenGlobalBudget={() => setActiveTab('global-budget-detail')} />}
          {activeTab === 'budget-detail' && selectedBudget && (
            <BudgetDetailView
              key={`bd-${selectedBudget.id}-${budgetDetailKey}`}
              user={user}
              budget={selectedBudget}
              initialPeriodId={selectedPeriodId}
              onBack={backFromBudgetDetail}
              onRefresh={() => setBudgetDetailKey(k => k + 1)}
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
        </ChunkErrorBoundary>
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
