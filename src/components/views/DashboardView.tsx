'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, getYearRange, getMonthName } from '@/lib/utils';
import { format } from 'date-fns';
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
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthRange = getMonthRange(lastMonth);
      const yearRange = getYearRange(now);

      // Calculate the start date for 6 months ago (for chart)
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const chartStart = format(sixMonthsAgo, 'yyyy-MM-dd');

      // Only 2 parallel queries instead of 8+ sequential ones
      const [{ data: allExpenses }, { data: allCategories }] = await Promise.all([
        supabase
          .from('expenses')
          .select('amount, category_id, date')
          .eq('user_id', user.id)
          .gte('date', chartStart)
          .lte('date', monthRange.end)
          .order('date', { ascending: false }),
        supabase
          .from('categories')
          .select('*')
          .eq('user_id', user.id),
      ]);

      const expenses = allExpenses || [];
      const categories = (allCategories || []).filter(c => !c.parent_id);
      const subcategories = (allCategories || []).filter(c => c.parent_id);

      // Current month
      const monthExp = expenses.filter(e => e.date >= monthRange.start && e.date <= monthRange.end);
      const mTotal = monthExp.reduce((sum, e) => sum + Number(e.amount), 0);
      setMonthlyTotal(mTotal);

      // Last month
      const lastMonthExp = expenses.filter(e => e.date >= lastMonthRange.start && e.date <= lastMonthRange.end);
      setLastMonthTotal(lastMonthExp.reduce((sum, e) => sum + Number(e.amount), 0));

      // Year total
      const yearExp = expenses.filter(e => e.date >= yearRange.start && e.date <= yearRange.end);
      setYearlyTotal(yearExp.reduce((sum, e) => sum + Number(e.amount), 0));

      // Category spending (with subcategories summed into parent)
      const spending: CategorySpending[] = categories.map((cat) => {
        const subIds = subcategories.filter(sc => sc.parent_id === cat.id).map(sc => sc.id);
        const allIds = [cat.id, ...subIds];
        const spent = monthExp
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

      // Monthly chart - calculate from the same data, no extra queries
      const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const chartData: { name: string; total: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const range = getMonthRange(d);
        const total = expenses
          .filter(e => e.date >= range.start && e.date <= range.end)
          .reduce((sum, e) => sum + Number(e.amount), 0);
        chartData.push({ name: months[d.getMonth()], total });
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
