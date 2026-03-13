'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, getMonthRange, exportToCSV } from '@/lib/utils';
import { Category, Expense } from '@/types';
import { Plus, Search, Download, ChevronLeft, ChevronRight, Trash2, Edit3, X, Calendar, DollarSign, FileText } from 'lucide-react';

export default function ExpensesView({ user }: { user: User }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [monthOffset, setMonthOffset] = useState(0);

  // Form state
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);

  const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const monthRange = getMonthRange(currentMonth);
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  useEffect(() => {
    loadData();
  }, [monthOffset]);

  async function loadData() {
    setLoading(true);
    const [{ data: exp }, { data: cats }] = await Promise.all([
      supabase
        .from('expenses')
        .select('*, category:categories(*)')
        .eq('user_id', user.id)
        .gte('date', monthRange.start)
        .lte('date', monthRange.end)
        .order('date', { ascending: false }),
      supabase
        .from('categories')
        .select('*')
        .eq('user_id', user.id)
        .order('name'),
    ]);
    setExpenses(exp || []);
    setCategories(cats || []);
    setLoading(false);
  }

  function openForm(expense?: Expense) {
    if (expense) {
      setEditingId(expense.id);
      setAmount(String(expense.amount));
      setDescription(expense.description);
      setNotes(expense.notes || '');
      setCategoryId(expense.category_id || '');
      setDate(expense.date);
    } else {
      setEditingId(null);
      setAmount('');
      setDescription('');
      setNotes('');
      setCategoryId('');
      setDate(new Date().toISOString().split('T')[0]);
    }
    setShowForm(true);
  }

  async function handleSave() {
    if (!amount || !description) return;
    setSaving(true);

    const data = {
      user_id: user.id,
      amount: parseFloat(amount),
      description,
      notes: notes || null,
      category_id: categoryId || null,
      date,
    };

    try {
      if (editingId) {
        await supabase.from('expenses').update(data).eq('id', editingId);
      } else {
        await supabase.from('expenses').insert(data);
      }
      setShowForm(false);
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
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
      Notas: e.notes || '',
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
            onClick={() => openForm()}
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
          <p className="text-xs text-dark-400">{formatCurrency(monthTotal)}</p>
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
                <span className="text-sm font-bold text-red-400">-{formatCurrency(Number(expense.amount))}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openForm(expense)} className="p-1.5 text-dark-400 hover:text-dark-200">
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

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end">
          <div className="bg-dark-800 w-full rounded-t-3xl p-5 slide-up max-w-lg mx-auto max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">{editingId ? 'Editar gasto' : 'Nuevo gasto'}</h2>
              <button onClick={() => setShowForm(false)} className="text-dark-400 p-1">
                <X size={22} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Amount */}
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Monto *</label>
                <div className="relative">
                  <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-dark-700 border border-dark-600 rounded-xl py-3 pl-9 pr-4 text-lg font-semibold placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                    autoFocus
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Descripción *</label>
                <div className="relative">
                  <FileText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                  <input
                    type="text"
                    placeholder="Ej: Supermercado, Uber, Netflix..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-dark-700 border border-dark-600 rounded-xl py-3 pl-9 pr-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Categoría</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors appearance-none"
                >
                  <option value="">Sin categoría</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Fecha</label>
                <div className="relative">
                  <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-dark-700 border border-dark-600 rounded-xl py-3 pl-9 pr-4 text-sm focus:outline-none focus:border-brand-500 transition-colors"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Notas (opcional)</label>
                <textarea
                  placeholder="Algún detalle extra..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-dark-700 border border-dark-600 rounded-xl py-3 px-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors resize-none"
                />
              </div>

              {/* Submit */}
              <button
                onClick={handleSave}
                disabled={saving || !amount || !description}
                className="w-full bg-brand-600 hover:bg-brand-500 disabled:bg-dark-600 text-white font-semibold py-3.5 rounded-xl transition-all text-sm"
              >
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar gasto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
