'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Category, RecurringExpense } from '@/types';
import { Plus, Edit3, Trash2, X, Pause, Play, FileText, CalendarOff, Delete } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export default function RecurringView({ user }: { user: User }) {
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [frequency, setFrequency] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function onResize() {
      if (!vv) return;
      const diff = window.innerHeight - vv.height;
      setKeyboardHeight(diff > 50 ? diff : 0);
    }
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  function handleNumpad(key: string) {
    if (key === 'backspace') {
      setAmount(prev => prev.slice(0, -1));
    } else if (key === '.') {
      if (!amount.includes('.')) {
        setAmount(prev => (prev || '0') + '.');
      }
    } else {
      if (amount.includes('.')) {
        const decimals = amount.split('.')[1];
        if (decimals && decimals.length >= 2) return;
      }
      setAmount(prev => prev + key);
    }
  }

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [{ data: rec }, { data: cats }] = await Promise.all([
      supabase
        .from('recurring_expenses')
        .select('*, category:categories(*)')
        .eq('user_id', user.id)
        .order('description'),
      supabase.from('categories').select('*').eq('user_id', user.id).order('name'),
    ]);
    setItems(rec || []);
    setCategories(cats || []);
    setLoading(false);
  }

  function openForm(item?: RecurringExpense) {
    if (item) {
      setEditingId(item.id);
      setAmount(String(item.amount));
      setDescription(item.description);
      setNotes(item.notes || '');
      setCategoryId(item.category_id || '');
      setFrequency(item.frequency);
      setDayOfMonth(String(item.day_of_month));
      setEndDate(item.end_date || '');
    } else {
      setEditingId(null);
      setAmount('');
      setDescription('');
      setNotes('');
      setCategoryId('');
      setFrequency('monthly');
      setDayOfMonth('1');
      setEndDate('');
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
      frequency,
      day_of_month: parseInt(dayOfMonth),
      end_date: endDate || null,
      is_active: true,
    };

    try {
      if (editingId) {
        await supabase.from('recurring_expenses').update(data).eq('id', editingId);
      } else {
        await supabase.from('recurring_expenses').insert(data);
      }
      setShowForm(false);
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('recurring_expenses').update({ is_active: !current }).eq('id', id);
    loadData();
  }

  async function handleDelete(id: string) {
    if (confirm('¿Eliminar este gasto recurrente?')) {
      await supabase.from('recurring_expenses').delete().eq('id', id);
      loadData();
    }
  }

  const totalMonthly = items
    .filter(i => i.is_active)
    .reduce((sum, i) => {
      if (i.frequency === 'monthly') return sum + Number(i.amount);
      if (i.frequency === 'weekly') return sum + Number(i.amount) * 4.33;
      if (i.frequency === 'yearly') return sum + Number(i.amount) / 12;
      return sum;
    }, 0);

  const freqLabels: Record<string, string> = { weekly: 'Semanal', monthly: 'Mensual', yearly: 'Anual' };

  return (
    <div className="px-4 pt-6 pb-24 max-w-lg mx-auto page-transition">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Gastos fijos</h1>
        <button
          onClick={() => openForm()}
          className="bg-brand-600 hover:bg-brand-500 text-white p-2.5 rounded-xl transition-colors shadow-lg shadow-brand-600/20"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Summary */}
      <div className="bg-dark-800 rounded-xl p-4 mb-5">
        <p className="text-dark-400 text-xs">Total mensual estimado</p>
        <p className="text-2xl font-bold mt-1">{formatCurrency(totalMonthly)}</p>
        <p className="text-dark-500 text-xs mt-1">{items.filter(i => i.is_active).length} gastos activos</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-5xl mb-4">🔄</div>
          <p className="text-dark-300 font-medium">No tenés gastos fijos</p>
          <p className="text-dark-500 text-sm mt-1">Agregá cosas como alquiler, Netflix, gym...</p>
          <button
            onClick={() => openForm()}
            className="mt-4 bg-brand-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl"
          >
            Agregar gasto fijo
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={`bg-dark-800 rounded-xl p-3.5 flex items-center justify-between ${!item.is_active ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-xl">{(item as any).category?.icon || '🔄'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.description}</p>
                  <p className="text-xs text-dark-400">
                    {freqLabels[item.frequency]}
                    {item.frequency !== 'weekly' && ` · Día ${item.day_of_month}`}
                    {(item as any).category && ` · ${(item as any).category.name}`}
                  </p>
                  {item.end_date && (
                    <p className="text-[10px] text-dark-500 mt-0.5">
                      Hasta {format(parseISO(item.end_date), "d MMM yyyy", { locale: es })}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-bold">{formatCurrency(Number(item.amount))}</span>
                <button
                  onClick={() => toggleActive(item.id, item.is_active)}
                  className={`p-1.5 rounded-lg ${item.is_active ? 'text-brand-400' : 'text-dark-500'}`}
                >
                  {item.is_active ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button onClick={() => openForm(item)} className="p-1.5 text-dark-400 hover:text-dark-200">
                  <Edit3 size={14} />
                </button>
                <button onClick={() => handleDelete(item.id)} className="p-1.5 text-dark-400 hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal - Fullscreen */}
      {showForm && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => setShowForm(false)} className="p-1 text-dark-400 hover:text-white">
              <X size={24} />
            </button>
            <h2 className="text-base font-bold">{editingId ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}</h2>
            <div className="w-8" />
          </div>

          {/* Amount display */}
          <div className="px-5 py-4 flex-shrink-0 border-b border-dark-800">
            <p className="text-xs text-dark-400 font-medium mb-1">Monto *</p>
            <p className="text-3xl font-extrabold text-white">{amount || '0'}</p>
          </div>

          {/* Scrollable form fields */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block">Descripción *</label>
              <div className="relative">
                <FileText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
                <input
                  type="text"
                  placeholder="Ej: Alquiler, Netflix, Gym..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onFocus={() => setIsTyping(true)}
                  onBlur={() => setIsTyping(false)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 pl-9 pr-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block">Categoría</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors appearance-none"
              >
                <option value="">Sin categoría</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Frecuencia</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as any)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors appearance-none"
                >
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensual</option>
                  <option value="yearly">Anual</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Día del mes</label>
                <input
                  type="number"
                  min="1"
                  max="28"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
            </div>

            {/* End date (optional) */}
            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 flex items-center gap-1.5">
                <CalendarOff size={12} />
                Fecha de finalización (opcional)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1 bg-dark-800 border border-dark-700 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors"
                />
                {endDate && (
                  <button
                    onClick={() => setEndDate('')}
                    className="p-2.5 bg-dark-800 border border-dark-700 rounded-xl text-dark-400 hover:text-red-400 transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {!endDate && (
                <p className="text-[10px] text-dark-500 mt-1">Sin fecha = se repite indefinidamente</p>
              )}
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block">Notas (opcional)</label>
              <textarea
                placeholder="Algún detalle extra..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 px-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors resize-none"
              />
            </div>
          </div>

          {/* Bottom: button + numpad or floating button */}
          {isTyping && keyboardHeight > 0 ? (
            <div
              className="fixed left-0 right-0 z-[70]"
              style={{ bottom: `${keyboardHeight}px` }}
            >
              <button
                onClick={(e) => { e.preventDefault(); handleSave(); }}
                disabled={saving || !amount || !description}
                className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-30 text-white font-bold py-4 transition-all text-base"
              >
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar gasto fijo'}
              </button>
            </div>
          ) : !isTyping ? (
            <div className="flex-shrink-0">
              <div className="px-5 py-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !amount || !description}
                  className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-30 text-white font-bold py-4 rounded-2xl transition-all text-base"
                >
                  {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar gasto fijo'}
                </button>
              </div>
              <div className="border-t border-dark-700">
                <div className="grid grid-cols-3">
                  {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map((key) => {
                    const isDel = key === 'backspace';
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          if (isDel) handleNumpad('backspace');
                          else handleNumpad(key);
                        }}
                        className="py-[14px] text-center text-xl font-medium border-b border-r border-dark-800 active:bg-dark-700 transition-colors bg-dark-900 text-white"
                      >
                        {isDel ? <span className="flex items-center justify-center"><Delete size={22} /></span> : key}
                      </button>
                    );
                  })}
                </div>
                <div className="h-[env(safe-area-inset-bottom)]" />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
