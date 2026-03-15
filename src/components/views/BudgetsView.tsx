'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getBudgetPeriodRange } from '@/lib/utils';
import { Budget, Category } from '@/types';
import { Plus, X, ChevronRight, Delete } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Props {
  user: User;
  onOpenBudget: (budget: Budget) => void;
}

export default function BudgetsView({ user, onOpenBudget }: Props) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [recurrence, setRecurrence] = useState<'monthly' | 'yearly'>('monthly');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedCatIds, setSelectedCatIds] = useState<string[]>([]);
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [btnBottom, setBtnBottom] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function update() {
      if (!vv) return;
      const bottom = window.innerHeight - (vv.height + vv.offsetTop);
      setBtnBottom(bottom > 50 ? bottom - 44 : 0);
    }
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
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
    try {
      const [{ data: budgetsData }, { data: catsData }, { data: bcData }] = await Promise.all([
        supabase.from('budgets').select('*').eq('user_id', user.id).order('name'),
        supabase.from('categories').select('*').eq('user_id', user.id).order('name'),
        supabase.from('budget_categories').select('*'),
      ]);

      const allCats = catsData || [];
      setCategories(allCats);

      // For each budget, compute spent amount
      const enriched: Budget[] = [];
      for (const b of (budgetsData || [])) {
        const catIds = (bcData || []).filter(bc => bc.budget_id === b.id).map(bc => bc.category_id);
        const bCats = allCats.filter(c => catIds.includes(c.id));

        // Include subcategory IDs too
        const allCatIds = [...catIds];
        allCats.forEach(c => {
          if (c.parent_id && catIds.includes(c.parent_id) && !allCatIds.includes(c.id)) {
            allCatIds.push(c.id);
          }
        });

        const range = getBudgetPeriodRange(b.start_date, b.recurrence);

        let spent = 0;
        if (allCatIds.length > 0) {
          const { data: expenses } = await supabase
            .from('expenses')
            .select('amount')
            .eq('user_id', user.id)
            .in('category_id', allCatIds)
            .gte('date', range.start)
            .lte('date', range.end);
          spent = (expenses || []).reduce((sum, e) => sum + Number(e.amount), 0);
        }

        enriched.push({
          ...b,
          category_ids: catIds,
          categories: bCats,
          spent,
        });
      }

      setBudgets(enriched);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openForm(budget?: Budget) {
    if (budget) {
      setEditingBudget(budget);
      setName(budget.name);
      setAmount(String(budget.amount));
      setRecurrence(budget.recurrence);
      setStartDate(budget.start_date);
      setSelectedCatIds(budget.category_ids || []);
    } else {
      setEditingBudget(null);
      setName('');
      setAmount('');
      setRecurrence('monthly');
      setStartDate(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
      setSelectedCatIds([]);
    }
    setShowForm(true);
  }

  async function handleSave() {
    if (!name || !amount) return;
    setSaving(true);

    try {
      const budgetData = {
        user_id: user.id,
        name,
        amount: parseFloat(amount),
        recurrence,
        start_date: startDate,
      };

      let budgetId: string;

      if (editingBudget) {
        await supabase.from('budgets').update(budgetData).eq('id', editingBudget.id);
        budgetId = editingBudget.id;
        // Delete old category links
        await supabase.from('budget_categories').delete().eq('budget_id', budgetId);
      } else {
        const { data } = await supabase.from('budgets').insert(budgetData).select().single();
        budgetId = data.id;
      }

      // Insert category links
      if (selectedCatIds.length > 0) {
        await supabase.from('budget_categories').insert(
          selectedCatIds.map(cid => ({ budget_id: budgetId, category_id: cid }))
        );
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
    if (confirm('¿Eliminar este presupuesto?')) {
      await supabase.from('budgets').delete().eq('id', id);
      loadData();
    }
  }

  function toggleCat(catId: string) {
    setSelectedCatIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    );
  }

  const parentCats = categories.filter(c => !c.parent_id);
  const getSubcats = (pid: string) => categories.filter(c => c.parent_id === pid);
  const recurrenceLabels: Record<string, string> = { monthly: 'Mensual', yearly: 'Anual' };

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto page-transition">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Presupuestos</h1>
        <button
          onClick={() => openForm()}
          className="bg-brand-600 hover:bg-brand-500 text-white p-2.5 rounded-xl transition-colors shadow-lg shadow-brand-600/20"
        >
          <Plus size={18} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : budgets.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-5xl mb-4">💰</div>
          <p className="text-dark-300 font-medium">No tenés presupuestos</p>
          <p className="text-dark-500 text-sm mt-1">Creá uno para controlar tus gastos</p>
          <button
            onClick={() => openForm()}
            className="mt-5 bg-brand-600/15 text-brand-400 text-sm font-semibold px-6 py-3 rounded-2xl border border-brand-600/20 hover:bg-brand-600/25 transition-colors"
          >
            Crear presupuesto
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((budget) => {
            const spent = budget.spent || 0;
            const left = Math.max(budget.amount - spent, 0);
            const pct = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
            const range = getBudgetPeriodRange(budget.start_date, budget.recurrence);
            const startLabel = format(new Date(range.start + 'T00:00'), "MMM d, yyyy", { locale: es });
            const endLabel = format(new Date(range.end + 'T00:00'), "MMM d, yyyy", { locale: es });

            return (
              <button
                key={budget.id}
                onClick={() => onOpenBudget(budget)}
                className="w-full bg-dark-800 rounded-2xl p-4 text-left hover:bg-dark-750 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-bold">{budget.name}</h3>
                  <ChevronRight size={16} className="text-dark-500" />
                </div>

                <div className="flex items-baseline gap-1.5 mb-2">
                  <span className={`text-lg font-extrabold ${pct >= 100 ? 'text-red-400' : 'text-brand-400'}`}>
                    {formatCurrency(left)}
                  </span>
                  <span className="text-dark-500 text-xs">de {formatCurrency(budget.amount)}</span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-dark-700 rounded-full h-2 mb-2.5">
                  <div
                    className="h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(pct, 100)}%`,
                      backgroundColor: pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e',
                    }}
                  />
                  {/* Percentage label inside */}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-dark-500 capitalize">{startLabel}</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      pct >= 100 ? 'bg-red-500/15 text-red-400' : 'bg-brand-500/15 text-brand-400'
                    }`}
                  >
                    {pct.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-dark-500 capitalize">{endLabel}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ===== CREATE/EDIT FORM ===== */}
      {showForm && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => setShowForm(false)} className="p-1 text-dark-400 hover:text-white">
              <X size={24} />
            </button>
            <h2 className="text-base font-bold">
              {editingBudget ? 'Editar presupuesto' : 'Nuevo presupuesto'}
            </h2>
            {editingBudget ? (
              <button
                onClick={() => { handleDelete(editingBudget.id); setShowForm(false); }}
                className="p-1 text-red-400 hover:text-red-300"
              >
                🗑️
              </button>
            ) : (
              <div className="w-8" />
            )}
          </div>

          {/* Amount display */}
          <div className="px-5 py-4 flex-shrink-0 border-b border-dark-800">
            <p className="text-xs text-dark-400 font-medium mb-1 uppercase tracking-wider">Monto</p>
            <p className="text-3xl font-extrabold text-white">{amount || '0'}</p>
          </div>

          {/* Scrollable form fields */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Budget name */}
            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Nombre</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg">💰</span>
                <input
                  type="text"
                  placeholder="Ej: Car, Groceries..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={() => setIsTyping(true)}
                  onBlur={() => setIsTyping(false)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 pl-11 pr-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
            </div>

            {/* Recurrence */}
            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Recurrencia</label>
              <div className="flex bg-dark-800 rounded-xl p-1 border border-dark-700">
                {(['monthly', 'yearly'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRecurrence(r)}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${
                      recurrence === r ? 'bg-brand-600 text-white shadow-lg' : 'text-dark-400'
                    }`}
                  >
                    {recurrenceLabels[r]}
                  </button>
                ))}
              </div>
            </div>

            {/* Start date */}
            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Fecha inicio</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>

            {/* Category picker */}
            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">
                Categorías incluidas ({selectedCatIds.length})
              </label>
              <button
                onClick={() => setShowCatPicker(true)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 px-4 text-sm text-left flex items-center justify-between hover:border-dark-600 transition-colors"
              >
                <span className={selectedCatIds.length > 0 ? 'text-white' : 'text-dark-500'}>
                  {selectedCatIds.length > 0
                    ? categories.filter(c => selectedCatIds.includes(c.id)).map(c => `${c.icon} ${c.name}`).join(', ')
                    : 'Seleccionar categorías...'
                  }
                </span>
                <ChevronRight size={16} className="text-dark-500" />
              </button>
            </div>
          </div>

          {/* Bottom: button + numpad or floating button */}
          {isTyping && btnBottom > 0 ? (
            <div
              className="fixed left-0 right-0 z-[70]"
              style={{ bottom: `${btnBottom}px` }}
            >
              <button
                onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
                disabled={saving || !name || !amount}
                className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-30 text-white font-bold py-4 transition-all text-base"
              >
                {saving ? 'Guardando...' : editingBudget ? 'Guardar cambios' : 'Crear presupuesto'}
              </button>
            </div>
          ) : (
            <div className="flex-shrink-0">
              <div className="px-5 py-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !name || !amount}
                  className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-30 text-white font-bold py-4 rounded-2xl transition-all text-base"
                >
                  {saving ? 'Guardando...' : editingBudget ? 'Guardar cambios' : 'Crear presupuesto'}
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
          )}
        </div>
      )}

      {/* ===== CATEGORY PICKER OVERLAY ===== */}
      {showCatPicker && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-end">
          <div className="bg-dark-800 w-full rounded-t-3xl max-h-[75vh] overflow-y-auto slide-up">
            <div className="flex items-center justify-between p-4 border-b border-dark-700 sticky top-0 bg-dark-800 z-10">
              <button onClick={() => setShowCatPicker(false)} className="p-1 text-dark-400">
                <X size={20} />
              </button>
              <h3 className="text-base font-bold">Categorías del presupuesto</h3>
              <button
                onClick={() => {
                  const allIds = categories.map(c => c.id);
                  if (selectedCatIds.length === allIds.length) {
                    setSelectedCatIds([]);
                  } else {
                    setSelectedCatIds(allIds);
                  }
                }}
                className="text-xs text-brand-400 font-medium"
              >
                {selectedCatIds.length === categories.length ? 'Ninguna' : 'Todas'}
              </button>
            </div>

            {parentCats.map((cat) => {
              const isSelected = selectedCatIds.includes(cat.id);
              const subs = getSubcats(cat.id);
              return (
                <div key={cat.id}>
                  <button
                    onClick={() => toggleCat(cat.id)}
                    className="w-full flex items-center gap-3 px-4 py-4 border-b border-dark-700/30 active:bg-dark-700/50 transition-colors"
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                      style={{ backgroundColor: cat.color + '25' }}
                    >
                      {cat.icon}
                    </div>
                    <span className="text-sm font-medium flex-1 text-left">{cat.name}</span>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      isSelected ? 'bg-brand-500 border-brand-500' : 'border-dark-600'
                    }`}>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  </button>
                  {subs.map((sub) => {
                    const subSelected = selectedCatIds.includes(sub.id);
                    return (
                      <button
                        key={sub.id}
                        onClick={() => toggleCat(sub.id)}
                        className="w-full flex items-center gap-3 pl-10 pr-4 py-3 border-b border-dark-700/20 active:bg-dark-700/50 transition-colors"
                      >
                        <span className="text-dark-500 text-xs">└</span>
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                          style={{ backgroundColor: (sub.color || cat.color) + '25' }}
                        >
                          {sub.icon}
                        </div>
                        <span className="text-sm text-dark-200 flex-1 text-left">{sub.name}</span>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          subSelected ? 'bg-brand-500 border-brand-500' : 'border-dark-600'
                        }`}>
                          {subSelected && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            <div className="h-8" />
          </div>
        </div>
      )}
    </div>
  );
}
