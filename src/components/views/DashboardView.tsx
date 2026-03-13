'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, getYearRange } from '@/lib/utils';
import { format, parseISO, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { Expense, Category } from '@/types';
import { Plus, Trash2, Edit3, ChevronRight, PieChart } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import AddExpenseModal from '@/components/AddExpenseModal';

type ViewMode = 'months' | 'years';

export default function DashboardView({ user, onNavigate }: { user: User; onNavigate: (tab: any) => void }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('months');
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const startDate = format(subMonths(new Date(), 11), 'yyyy-MM-dd');
      const { data: exp } = await supabase
        .from('expenses')
        .select('*, category:categories(*)')
        .eq('user_id', user.id)
        .gte('date', startDate)
        .order('date', { ascending: false });
      setExpenses(exp || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const now = new Date();
  const monthRange = getMonthRange(now);
  const yearRange = getYearRange(now);

  const currentMonthExp = expenses.filter(e => e.date >= monthRange.start && e.date <= monthRange.end);
  const currentYearExp = expenses.filter(e => e.date >= yearRange.start && e.date <= yearRange.end);

  const accumulatedTotal = viewMode === 'months'
    ? currentMonthExp.reduce((sum, e) => sum + Number(e.amount), 0)
    : currentYearExp.reduce((sum, e) => sum + Number(e.amount), 0);

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
          data.push({
            name: format(d, 'MMM yyyy', { locale: es }),
            total,
            isCurrent: i === 0,
          });
        }
        return data;
      })()
    : (() => {
        const data: { name: string; total: number; isCurrent: boolean }[] = [];
        for (let m = 0; m < 12; m++) {
          const d = new Date(now.getFullYear(), m, 1);
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

  // Group by day
  const displayExpenses = viewMode === 'months' ? currentMonthExp : currentYearExp;
  const dayMap = new Map<string, Expense[]>();
  displayExpenses.forEach(exp => {
    if (!dayMap.has(exp.date)) dayMap.set(exp.date, []);
    dayMap.get(exp.date)!.push(exp);
  });

  const today = format(now, 'yyyy-MM-dd');
  const yesterday = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');

  const groupedByDay = Array.from(dayMap.entries())
    .map(([dateStr, exps]) => ({
      date: dateStr,
      label: dateStr === today ? 'Hoy' : dateStr === yesterday ? 'Ayer' : format(parseISO(dateStr), "d 'de' MMMM", { locale: es }),
      total: exps.reduce((sum, e) => sum + Number(e.amount), 0),
      expenses: exps,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto page-transition">
      {/* Accumulated total */}
      <div className="pt-8 pb-3 text-center">
        <p className="text-[2rem] font-extrabold tracking-tight">
          -{formatCurrency(accumulatedTotal)}
        </p>
        <p className="text-dark-400 text-xs mt-0.5">
          {viewMode === 'months'
            ? format(now, 'MMMM yyyy', { locale: es })
            : now.getFullYear().toString()
          }
        </p>
      </div>

      {/* Toggle months/years */}
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

      {/* Bar chart */}
      <div className="px-4 mb-1">
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} barCategoryGap={viewMode === 'years' ? '12%' : '18%'}>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748b', fontSize: 9 }}
              interval={0}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '10px',
                color: '#f1f5f9',
                fontSize: '12px',
                padding: '6px 10px',
              }}
              formatter={(value: number) => [formatCurrency(value), '']}
              labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
            />
            <Bar dataKey="total" radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.isCurrent ? '#ef4444' : 'rgba(239,68,68,0.2)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Spending Overview button */}
      <div className="px-4 py-2 mb-1">
        <button
          onClick={() => onNavigate('overview')}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-dark-300 hover:text-dark-100 transition-colors"
        >
          <PieChart size={16} className="text-brand-400" />
          <span className="text-sm font-medium">Spending Overview</span>
          <ChevronRight size={14} className="text-dark-500" />
        </button>
      </div>

      {/* Expenses by day */}
      <div className="min-h-[200px]">
        {groupedByDay.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="text-5xl mb-4">🎯</div>
            <p className="text-dark-300 font-medium">No hay gastos</p>
            <p className="text-dark-500 text-sm mt-1">Tocá + para agregar tu primer gasto</p>
          </div>
        ) : (
          groupedByDay.map((group) => (
            <div key={group.date}>
              {/* Day header */}
              <div className="flex items-center justify-between px-4 py-2 bg-dark-900/60 border-t border-dark-800/80">
                <span className="text-xs font-semibold text-dark-400 uppercase tracking-wide capitalize">{group.label}</span>
                <span className="text-xs font-bold text-red-400">-{formatCurrency(group.total)}</span>
              </div>

              {/* Expenses */}
              {group.expenses.map((expense, idx) => {
                const cat = (expense as any).category;
                return (
                  <div
                    key={expense.id}
                    className="flex items-center gap-3.5 px-4 py-3 border-b border-dark-800/40"
                  >
                    {/* Icon circle */}
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                      style={{ backgroundColor: cat?.color ? cat.color + '30' : '#47556930' }}
                    >
                      {cat?.icon || '💵'}
                    </div>

                    {/* Description + category */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate">{expense.description}</p>
                      <p className="text-[11px] text-dark-500 mt-0.5">
                        {cat?.name || 'Sin categoría'}
                        {expense.is_recurring && ' · 🔄'}
                      </p>
                    </div>

                    {/* Amount */}
                    <span className="text-[13px] font-bold text-red-400 flex-shrink-0">
                      -{formatCurrency(Number(expense.amount))}
                    </span>

                    {/* Edit/Delete */}
                    <div className="flex flex-shrink-0 -mr-1">
                      <button onClick={() => openEdit(expense)} className="p-1 text-dark-600 hover:text-dark-300">
                        <Edit3 size={12} />
                      </button>
                      <button onClick={() => handleDelete(expense.id)} className="p-1 text-dark-600 hover:text-red-400">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => { setEditingExpense(null); setShowAddExpense(true); }}
        className="fixed bottom-24 right-5 bg-brand-500 text-white w-14 h-14 rounded-full shadow-xl shadow-black/30 flex items-center justify-center z-40 active:scale-95 transition-transform"
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>

      {/* Modal */}
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
