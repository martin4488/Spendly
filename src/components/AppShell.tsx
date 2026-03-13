'use client';

import { useState } from 'react';
import { User } from '@supabase/supabase-js';
import { LayoutDashboard, Receipt, FolderTree, RefreshCcw, Settings } from 'lucide-react';
import DashboardView from '@/components/views/DashboardView';
import ExpensesView from '@/components/views/ExpensesView';
import CategoriesView from '@/components/views/CategoriesView';
import RecurringView from '@/components/views/RecurringView';
import SettingsView from '@/components/views/SettingsView';
import SpendingOverview from '@/components/views/SpendingOverview';

type Tab = 'dashboard' | 'expenses' | 'categories' | 'recurring' | 'settings' | 'overview';

const tabs: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
  { id: 'expenses', label: 'Gastos', icon: Receipt },
  { id: 'categories', label: 'Categorías', icon: FolderTree },
  { id: 'recurring', label: 'Fijos', icon: RefreshCcw },
  { id: 'settings', label: 'Más', icon: Settings },
];

export default function AppShell({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  return (
    <div className="min-h-screen pb-20">
      {/* Content */}
      <main className="page-transition">
        {activeTab === 'dashboard' && <DashboardView user={user} onNavigate={setActiveTab} />}
        {activeTab === 'expenses' && <ExpensesView user={user} />}
        {activeTab === 'categories' && <CategoriesView user={user} />}
        {activeTab === 'recurring' && <RecurringView user={user} />}
        {activeTab === 'settings' && <SettingsView user={user} />}
        {activeTab === 'overview' && <SpendingOverview user={user} onBack={() => setActiveTab('dashboard')} />}
      </main>

      {/* Bottom Nav - hidden on overview */}
      {activeTab !== 'overview' && (
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
