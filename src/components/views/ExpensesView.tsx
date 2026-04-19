'use client';

import { useState, useEffect, lazy, Suspense } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatDate, getMonthRange, exportToCSV } from '@/lib/utils';
import { Expense } from '@/types';
import { Plus, Search, Download, ChevronLeft, ChevronRight, Trash2, Edit3 } from 'lucide-react';
import type { CurrencyCode } from '@/lib/currency';
import Amount from '@/components/ui/Amount';

const AddExpenseModal = lazy(() => import('@/components/AddExpenseModal'));

export default function ExpensesView({ user, defaultCurrency = 'EUR' as CurrencyCode }: { user: User; defaultCurrency?: CurrencyCode }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [monthOffset, setMonthOffset] = useState(0);

  const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const monthRange = getMonthRange(currentMonth);
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  useEffect(() => {
    loadData();
  }, [monthOffset]);

  async function loadData() {
    setLoading(true);
    const { data: exp } = await supabase
      .from('expenses')
      .select('*, category:categories(*)')
      .eq('user_id', user.id)
      .gte('date', monthRange.start)
      .lte('date', monthRange.end)
      .order('date', { ascending: false });
    setExpenses(exp || []);
    setLoading(false);
  }

  function openEdit(expense: Expense) {
    setEditingExpense({
      id: expense.id,
      amount: Number(expense.amount),
      description: expense.description,
      category_id: expense.category_id,
      date: expense.date,
    });
    setShowForm(true);
  }

  function openNew() {
    setEditingExpense(null);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (confirm('¿Eliminar este gasto?')) {
      await supabase.from('expenses').delete().eq('id', id);
      loadData();
    }
  }

  function handleExport() {
    const data = expenses.map(e => ({
      Fecha: e.date,
      Descripción: e.description,
      Categoría: (e as any).category?.name || 'Sin categoría',
      Monto: e.amount,
    }));
    exportToCSV(data, `spendly-${monthRange.start}`);
  }

  const filtered = expenses.filter(e =>
    e.description.toLowerCase().includes(search.toLowerCase())
  );

  const monthTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto page-transition">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Gastos</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="bg-dark-800 p-2.5 rounded-xl text-dark-400 hover:text-dark-200 transition-colors"
            title="Exportar CSV"
          >
            <Download size={18} />
          </button>
          <button
            onClick={openNew}
            className="bg-brand-600 hover:bg-brand-500 text-white p-2.5 rounded-xl transition-colors shadow-lg shadow-brand-600/20"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* Month selector */}
      <div className="flex items-center justify-between bg-dark-800 rounded-xl px-4 py-3 mb-4">
        <button onClick={() => setMonthOffset(o => o - 1)} className="text-dark-400 p-1">
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold">{monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}</p>
          <p className="text-xs text-dark-400"><Amount value={monthTotal} currency={defaultCurrency} size="sm" color="text-dark-400" weight="medium" /></p>
        </div>
        <button
          onClick={() => setMonthOffset(o => o + 1)}
          disabled={monthOffset >= 0}
          className="text-dark-400 p-1 disabled:opacity-30"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
        <input
          type="text"
          placeholder="Buscar gastos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-dark-800 border border-dark-700 rounded-xl py-2.5 pl-9 pr-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-dark-500 transition-colors"
        />
      </div>

      {/* Expense list */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-4xl mb-3">📝</div>
          <p className="text-dark-400 text-sm">No hay gastos este mes</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((expense) => (
            <div
              key={expense.id}
              className="bg-dark-800 rounded-xl p-3.5 flex items-center justify-between group"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-xl flex-shrink-0">
                  {(expense as any).category?.icon || '💵'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{expense.description}</p>
                  <p className="text-xs text-dark-400">
                    {formatDate(expense.date)}
                    {(expense as any).category && ` · ${(expense as any).category.name}`}
                    {expense.is_recurring && ' · 🔄'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Amount value={Number(expense.amount)} currency={defaultCurrency} sign="-" size="sm" color="text-red-400" weight="bold" />
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(expense)} className="p-1.5 text-dark-400 hover:text-dark-200">
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => handleDelete(expense.id)} className="p-1.5 text-dark-400 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal — lazy loaded */}
      {showForm && (
        <Suspense fallback={null}>
          <AddExpenseModal
            user={user}
            defaultCurrency={defaultCurrency}
            onClose={() => { setShowForm(false); setEditingExpense(null); }}
            onSaved={() => loadData()}
            editingExpense={editingExpense}
          />
        </Suspense>
      )}
    </div>
  );
}
