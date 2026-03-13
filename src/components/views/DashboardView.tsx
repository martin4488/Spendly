'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, getYearRange, getMonthName } from '@/lib/utils';
import { Category, Expense, CategorySpending } from '@/types';
import { TrendingDown, TrendingUp, Wallet, ChevronRight, Plus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';

export default function DashboardView({ user, onNavigate }: { user: User; onNavigate: (tab: any) => void }) {
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [yearlyTotal, setYearlyTotal] = useState(0);
  const [lastMonthTotal, setLastMonthTotal] = useState(0);
  const [categorySpending, setCategorySpending] = useState<CategorySpending[]>([]);
  const [monthlyChart, setMonthlyChart] = useState<{ name: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      const now = new Date();
      const monthRange = getMonthRange(now);
      const yearRange = getYearRange(now);
      
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthRange = getMonthRange(lastMonth);

      // Current month expenses
      const { data: monthExpenses } = await supabase
        .from('expenses')
        .select('amount')
        .eq('user_id', user.id)
        .gte('date', monthRange.start)
        .lte('date', monthRange.end);

      const mTotal = monthExpenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
      setMonthlyTotal(mTotal);

      // Last month total
      const { data: lastMonthExpenses } = await supabase
        .from('expenses')
        .select('amount')
        .eq('user_id', user.id)
        .gte('date', lastMonthRange.start)
        .lte('date', lastMonthRange.end);

      setLastMonthTotal(lastMonthExpenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0);

      // Year total
      const { data: yearExpenses } = await supabase
        .from('expenses')
        .select('amount')
        .eq('user_id', user.id)
        .gte('date', yearRange.start)
        .lte('date', yearRange.end);

      setYearlyTotal(yearExpenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0);

      // Category spending this month
      const { data: categories } = await supabase
        .from('categories')
        .select('*')
        .eq('user_id', user.id)
        .is('parent_id', null);

      const { data: subcategories } = await supabase
        .from('categories')
        .select('*')
        .eq('user_id', user.id)
        .not('parent_id', 'is', null);

      const { data: allExpenses } = await supabase
        .from('expenses')
        .select('amount, category_id')
        .eq('user_id', user.id)
        .gte('date', monthRange.start)
        .lte('date', monthRange.end);

      if (categories && allExpenses) {
        const spending: CategorySpending[] = categories.map((cat) => {
          // Get IDs of this category + its subcategories
          const subIds = (subcategories || [])
            .filter(sc => sc.parent_id === cat.id)
            .map(sc => sc.id);
          const allIds = [cat.id, ...subIds];

          const spent = allExpenses
            .filter(e => e.category_id && allIds.includes(e.category_id))
            .reduce((sum, e) => sum + Number(e.amount), 0);
          return {
            category_id: cat.id,
            category_name: cat.name,
            category_icon: cat.icon,
            category_color: cat.color,
            spent,
            budget: Number(cat.budget_amount),
            percentage: cat.budget_amount > 0 ? (spent / Number(cat.budget_amount)) * 100 : 0,
          };
        }).filter(c => c.spent > 0 || c.budget > 0)
          .sort((a, b) => b.spent - a.spent);

        setCategorySpending(spending);
      }

      // Monthly chart (last 6 months)
      const chartData: { name: string; total: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const range = getMonthRange(d);
        const { data: mExp } = await supabase
          .from('expenses')
          .select('amount')
          .eq('user_id', user.id)
          .gte('date', range.start)
          .lte('date', range.end);

        const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        chartData.push({
          name: months[d.getMonth()],
          total: mExp?.reduce((sum, e) => sum + Number(e.amount), 0) || 0,
        });
      }
      setMonthlyChart(chartData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const monthDiff = lastMonthTotal > 0
    ? ((monthlyTotal - lastMonthTotal) / lastMonthTotal) * 100
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto page-transition">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-dark-400 text-sm">Hola 👋</p>
          <h1 className="text-xl font-bold capitalize">{getMonthName()}</h1>
        </div>
        <button
          onClick={() => onNavigate('expenses')}
          className="bg-brand-600 hover:bg-brand-500 text-white p-3 rounded-xl transition-colors shadow-lg shadow-brand-600/20"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Main Card */}
      <div className="bg-gradient-to-br from-brand-600 to-brand-800 rounded-2xl p-5 mb-5 shadow-xl shadow-brand-900/30">
        <p className="text-brand-200 text-sm font-medium">Gastaste este mes</p>
        <p className="text-3xl font-extrabold text-white mt-1">{formatCurrency(monthlyTotal)}</p>
        {lastMonthTotal > 0 && (
          <div className={`flex items-center gap-1 mt-2 text-sm ${monthDiff > 0 ? 'text-red-200' : 'text-green-200'}`}>
            {monthDiff > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{Math.abs(monthDiff).toFixed(0)}% vs mes anterior</span>
          </div>
        )}
      </div>

      {/* Year total */}
      <div className="bg-dark-800 rounded-xl p-4 mb-5 flex items-center gap-3">
        <div className="bg-dark-700 p-2.5 rounded-lg">
          <Wallet size={18} className="text-dark-300" />
        </div>
        <div>
          <p className="text-dark-400 text-xs">Total anual</p>
          <p className="font-bold">{formatCurrency(yearlyTotal)}</p>
        </div>
      </div>

      {/* Monthly Bar Chart */}
      {monthlyChart.some(d => d.total > 0) && (
        <div className="bg-dark-800 rounded-xl p-4 mb-5">
          <h3 className="text-sm font-semibold mb-4 text-dark-200">Últimos 6 meses</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={monthlyChart} barCategoryGap="20%">
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '12px',
                  color: '#f1f5f9',
                  fontSize: '13px',
                }}
                formatter={(value: number) => [formatCurrency(value), 'Total']}
              />
              <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                {monthlyChart.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={i === monthlyChart.length - 1 ? '#22c55e' : '#334155'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Category Spending */}
      {categorySpending.length > 0 && (
        <div className="bg-dark-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-dark-200">Por categoría</h3>
            <button
              onClick={() => onNavigate('categories')}
              className="text-dark-400 text-xs flex items-center gap-1"
            >
              Ver todas <ChevronRight size={12} />
            </button>
          </div>

          <div className="space-y-3">
            {categorySpending.slice(0, 5).map((cat) => (
              <div key={cat.category_id}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{cat.category_icon}</span>
                    <span className="text-sm font-medium">{cat.category_name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold">{formatCurrency(cat.spent)}</span>
                    {cat.budget > 0 && (
                      <span className="text-dark-400 text-xs ml-1">/ {formatCurrency(cat.budget)}</span>
                    )}
                  </div>
                </div>
                {cat.budget > 0 && (
                  <div className="w-full bg-dark-700 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(cat.percentage, 100)}%`,
                        backgroundColor: cat.percentage >= 100 ? '#ef4444' : cat.percentage >= 80 ? '#f59e0b' : cat.category_color,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {categorySpending.length === 0 && monthlyTotal === 0 && (
        <div className="text-center py-10">
          <div className="text-5xl mb-4">🎯</div>
          <p className="text-dark-300 font-medium">Todavía no tenés gastos este mes</p>
          <p className="text-dark-500 text-sm mt-1">Tocá el botón + para agregar tu primer gasto</p>
        </div>
      )}
    </div>
  );
}
