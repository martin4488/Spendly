'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, getYearRange } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Category } from '@/types';
import { ArrowLeft } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

type ViewMode = 'months' | 'years';

const DONUT_COLORS = [
  '#D4A574', '#4A90D9', '#E8734A', '#F5A623', '#7ED321',
  '#50C8C6', '#9B59B6', '#E74C6F', '#95A5A6', '#2ECC71',
  '#3498DB', '#E67E22', '#1ABC9C', '#E74C3C', '#8E44AD',
];

interface CatSpend {
  id: string;
  name: string;
  icon: string;
  color: string;
  spent: number;
  percentage: number;
  transactions: number;
}

export default function SpendingOverview({ user, onBack }: { user: User; onBack: () => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [catSpending, setCatSpending] = useState<CatSpend[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('months');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [viewMode]);

  async function loadData() {
    setLoading(true);
    try {
      const now = new Date();
      const range = viewMode === 'months' ? getMonthRange(now) : getYearRange(now);

      const [{ data: expenses }, { data: cats }] = await Promise.all([
        supabase
          .from('expenses')
          .select('amount, category_id')
          .eq('user_id', user.id)
          .gte('date', range.start)
          .lte('date', range.end),
        supabase
          .from('categories')
          .select('*')
          .eq('user_id', user.id),
      ]);

      const allExpenses = expenses || [];
      const allCats = cats || [];
      const parentCats = allCats.filter(c => !c.parent_id);
      const subcats = allCats.filter(c => c.parent_id);

      const total = allExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
      setTotalSpent(total);
      setCategories(allCats);

      // Calculate spending per parent category (including subcategory spending)
      const spending: CatSpend[] = parentCats.map((cat, idx) => {
        const subIds = subcats.filter(sc => sc.parent_id === cat.id).map(sc => sc.id);
        const allIds = [cat.id, ...subIds];
        const catExpenses = allExpenses.filter(e => e.category_id && allIds.includes(e.category_id));
        const spent = catExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
        return {
          id: cat.id,
          name: cat.name,
          icon: cat.icon,
          color: DONUT_COLORS[idx % DONUT_COLORS.length],
          spent,
          percentage: total > 0 ? (spent / total) * 100 : 0,
          transactions: catExpenses.length,
        };
      }).filter(c => c.spent > 0)
        .sort((a, b) => b.spent - a.spent);

      // Add "Sin categoría" if there are uncategorized expenses
      const catIds = allCats.map(c => c.id);
      const uncategorized = allExpenses.filter(e => !e.category_id || !catIds.includes(e.category_id));
      if (uncategorized.length > 0) {
        const uncatSpent = uncategorized.reduce((sum, e) => sum + Number(e.amount), 0);
        spending.push({
          id: 'uncategorized',
          name: 'Sin categoría',
          icon: '📦',
          color: '#95A5A6',
          spent: uncatSpent,
          percentage: total > 0 ? (uncatSpent / total) * 100 : 0,
          transactions: uncategorized.length,
        });
      }

      setCatSpending(spending);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const now = new Date();
  const periodLabel = viewMode === 'months'
    ? format(now, 'MMMM yyyy', { locale: es })
    : now.getFullYear().toString();

  const donutData = catSpending.map(c => ({ name: c.name, value: c.spent, color: c.color }));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto page-transition pb-4">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-3">
        <button onClick={onBack} className="p-1 text-dark-300 hover:text-white transition-colors">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold flex-1 text-center pr-8">Overview</h1>
      </div>

      {/* Toggle */}
      <div className="flex justify-center mb-4">
        <div className="inline-flex bg-dark-800 rounded-full p-0.5">
          <button
            onClick={() => setViewMode('months')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              viewMode === 'months' ? 'bg-dark-600 text-white shadow-sm' : 'text-dark-400'
            }`}
          >
            Por meses
          </button>
          <button
            onClick={() => setViewMode('years')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              viewMode === 'years' ? 'bg-dark-600 text-white shadow-sm' : 'text-dark-400'
            }`}
          >
            Por año
          </button>
        </div>
      </div>

      {/* Period label */}
      <p className="text-center text-sm text-dark-400 capitalize mb-4">{periodLabel}</p>

      {/* Categories title + total */}
      <div className="px-4 mb-3">
        <h2 className="text-xl font-bold mb-3">Categorías</h2>
        <div className="bg-dark-800 rounded-xl p-4">
          <p className="text-red-400 text-2xl font-extrabold">-{formatCurrency(totalSpent)}</p>
          <p className="text-dark-400 text-xs mt-0.5">Gastos totales</p>
        </div>
      </div>

      {/* Donut Chart */}
      {catSpending.length > 0 && (
        <div className="px-4 mb-4">
          <div className="relative">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={110}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            {/* Percentage labels around the donut */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-lg font-bold">100%</p>
                <p className="text-[10px] text-dark-400">Total</p>
              </div>
            </div>
          </div>

          {/* Legend - colored dots */}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
            {catSpending.slice(0, 8).map(cat => (
              <div key={cat.id} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="text-[10px] text-dark-300">{cat.name} {cat.percentage.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category breakdown list */}
      <div className="px-4">
        {catSpending.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center gap-3.5 py-3.5 border-b border-dark-800/50"
          >
            {/* Icon */}
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-lg flex-shrink-0"
              className="w-11 h-11 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
style={{ backgroundColor: cat.color }}
            >
              {cat.icon}
            </div>

            {/* Name + transactions */}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold">{cat.name}</p>
              <p className="text-[11px] text-dark-500 mt-0.5">
                {cat.transactions} {cat.transactions === 1 ? 'transacción' : 'transacciones'}
              </p>
            </div>

            {/* Amount */}
            <span className="text-[13px] font-bold text-red-400 flex-shrink-0">
              -{formatCurrency(cat.spent)}
            </span>
          </div>
        ))}
      </div>

      {catSpending.length === 0 && (
        <div className="text-center py-10">
          <div className="text-5xl mb-4">📊</div>
          <p className="text-dark-300 font-medium">No hay datos para este período</p>
        </div>
      )}
    </div>
  );
}
