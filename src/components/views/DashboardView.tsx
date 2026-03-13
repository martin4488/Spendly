'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, getYearRange } from '@/lib/utils';
import { format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { Expense, Category } from '@/types';
import { Plus, ChevronLeft, ChevronRight, Trash2, Edit3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import AddExpenseModal from '@/components/AddExpenseModal';

type ViewMode = 'months' | 'years';

export default function DashboardView({ user, onNavigate }: { user: User; onNavigate: (tab: any) => void }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('months');
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      // Fetch last 12 months of data in 2 parallel queries
      const startDate = format(subMonths(new Date(), 11), 'yyyy-MM-dd');

      const [{ data: exp }, { data: cats }] = await Promise.all([
        supabase
          .from('expenses')
          .select('*, category:categories(*)')
          .eq('user_id', user.id)
          .gte('date', startDate)
          .order('date', { ascending: false }),
        supabase
          .from('categories')
          .select('*')
          .eq('user_id', user.id),
      ]);

      setExpenses(exp || []);
      setAllCategories(cats || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Current month expenses
  const now = new Date();
  const monthRange = getMonthRange(now);
  const yearRange = getYearRange(now);

  const currentMonthExpenses = expenses.filter(
    e => e.date >= monthRange.start && e.date <= monthRange.end
  );
  const currentYearExpenses = expenses.filter(
    e => e.date >= yearRange.start && e.date <= yearRange.end
  );

  const accumulatedTotal = viewMode === 'months'
    ? currentMonthExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
    : currentYearExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

  // Chart data
  const chartData = viewMode === 'months'
    ? (() => {
        const data: { name: string; total: number; isCurrent: boolean }[] = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const range = getMonthRange(d);
          const total = expenses
            .filter(e => e.date >= range.start && e.date <= range.end)
            .reduce((sum, e) => sum + Number(e.amount), 0);
          const label = format(d, "MMM\nyyyy", { locale: es });
          data.push({ name: label, total, isCurrent: i === 0 });
        }
        return data;
      })()
    : (() => {
        const data: { name: string; total: number; isCurrent: boolean }[] = [];
        const currentYear = now.getFullYear();
        // Show months of current year
        for (let m = 0; m < 12; m++) {
          const d = new Date(currentYear, m, 1);
          if (d > now) break;
          const range = getMonthRange(d);
          const total = expenses
            .filter(e => e.date >= range.start && e.date <= range.end)
            .reduce((sum, e) => sum + Number(e.amount), 0);
          data.push({
            name: format(d, 'MMM', { locale: es }),
            total,
            isCurrent: m === now.getMonth(),
          });
        }
        return data;
      })();

  // Group expenses by day (for current month view)
  const displayExpenses = viewMode === 'months' ? currentMonthExpenses : currentYearExpenses;
  const groupedByDay: { date: string; label: string; total: number; expenses: Expense[] }[] = [];
  const dayMap = new Map<string, Expense[]>();

  displayExpenses.forEach(exp => {
    const key = exp.date;
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(exp);
  });

  const today = format(now, 'yyyy-MM-dd');
  const yesterday = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');

  dayMap.forEach((exps, dateStr) => {
    let label: string;
    if (dateStr === today) {
      label = 'Hoy';
    } else if (dateStr === yesterday) {
      label = 'Ayer';
    } else {
      label = format(parseISO(dateStr), "d 'de' MMMM", { locale: es });
    }
    const total = exps.reduce((sum, e) => sum + Number(e.amount), 0);
    groupedByDay.push({ date: dateStr, label, total, expenses: exps });
  });

  groupedByDay.sort((a, b) => b.date.localeCompare(a.date));

  // Handlers
  function openEdit(expense: Expense) {
    setEditingExpense({
      id: expense.id,
      amount: Number(expense.amount),
      description: expense.description,
      category_id: expense.category_id,
      date: expense.date,
    });
    setShowAddExpense(true);
  }

  async function handleDelete(id: string) {
    if (confirm('¿Eliminar este gasto?')) {
      await supabase.from('expenses').delete().eq('id', id);
      loadData();
    }
  }

  const periodLabel = viewMode === 'months'
    ? format(now, "MMMM yyyy", { locale: es })
    : now.getFullYear().toString();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto page-transition">
      {/* Top section - Accumulated total */}
      <div className="px-4 pt-8 pb-4 text-center">
        <p className="text-3xl font-extrabold text-white">
          -{formatCurrency(accumulatedTotal)}
        </p>
        <p className="text-dark-400 text-sm mt-1 capitalize">{periodLabel}</p>
      </div>

      {/* View mode toggle */}
      <div className="flex justify-center mb-4 px-4">
        <div className="flex bg-dark-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setViewMode('months')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'months' ? 'bg-dark-600 text-white' : 'text-dark-400'
            }`}
          >
            Por meses
          </button>
          <button
            onClick={() => setViewMode('years')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'years' ? 'bg-dark-600 text-white' : 'text-dark-400'
            }`}
          >
            Por año
          </button>
        </div>
      </div>

      {/* Bar Chart */}
      {chartData.some(d => d.total > 0) && (
        <div className="px-4 mb-2">
          <div className="bg-dark-800 rounded-xl p-4">
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={chartData} barCategoryGap={viewMode === 'years' ? '15%' : '20%'}>
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  interval={0}
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
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.isCurrent ? '#ef4444' : '#ef444440'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Spending Overview link */}
      <div className="px-4 py-3">
        <button
          onClick={() => onNavigate('categories')}
          className="w-full flex items-center justify-center gap-2 text-dark-300 text-sm font-medium py-2"
        >
          <span>📊</span> Presupuestos <ChevronRight size={14} />
        </button>
      </div>

      {/* Expenses grouped by day */}
      <div>
        {groupedByDay.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="text-5xl mb-4">🎯</div>
            <p className="text-dark-300 font-medium">No hay gastos en este período</p>
            <p className="text-dark-500 text-sm mt-1">Tocá el botón + para agregar tu primer gasto</p>
          </div>
        ) : (
          groupedByDay.map((group) => (
            <div key={group.date}>
              {/* Day header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-dark-900/50">
                <span className="text-sm font-semibold text-dark-300 capitalize">{group.label}</span>
                <span className="text-sm font-semibold text-red-400">-{formatCurrency(group.total)}</span>
              </div>

              {/* Day expenses */}
              {group.expenses.map((expense) => {
                const cat = (expense as any).category;
                return (
                  <div
                    key={expense.id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-dark-800/50 active:bg-dark-800/30 transition-colors"
                  >
                    {/* Category icon */}
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                      style={{ backgroundColor: cat?.color ? cat.color + '25' : '#33415530' }}
                    >
                      {cat?.icon || '💵'}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{expense.description}</p>
                      <p className="text-xs text-dark-400">
                        {cat?.name || 'Sin categoría'}
                        {expense.is_recurring && ' · 🔄'}
                      </p>
                    </div>

                    {/* Amount */}
                    <span className="text-sm font-bold text-red-400 flex-shrink-0">
                      -{formatCurrency(Number(expense.amount))}
                    </span>

                    {/* Actions (visible on hover/tap) */}
                    <div className="flex gap-0.5 flex-shrink-0">
                      <button onClick={() => openEdit(expense)} className="p-1.5 text-dark-500 hover:text-dark-200">
                        <Edit3 size={13} />
                      </button>
                      <button onClick={() => handleDelete(expense.id)} className="p-1.5 text-dark-500 hover:text-red-400">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* FAB - Add expense */}
      <button
        onClick={() => { setEditingExpense(null); setShowAddExpense(true); }}
        className="fixed bottom-24 right-5 bg-brand-600 hover:bg-brand-500 text-white w-14 h-14 rounded-full shadow-xl shadow-brand-900/40 flex items-center justify-center transition-colors z-40"
      >
        <Plus size={26} />
      </button>

      {/* Add/Edit Expense Modal */}
      {showAddExpense && (
        <AddExpenseModal
          user={user}
          onClose={() => { setShowAddExpense(false); setEditingExpense(null); }}
          onSaved={() => loadData()}
          editingExpense={editingExpense}
        />
      )}
    </div>
  );
}
