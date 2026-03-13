'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, CATEGORY_ICONS, CATEGORY_COLORS } from '@/lib/utils';
import { Category } from '@/types';
import { Plus, Edit3, Trash2, X, FolderPlus } from 'lucide-react';

export default function CategoriesView({ user }: { user: User }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [spending, setSpending] = useState<Record<string, number>>({});

  // Form state
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📦');
  const [color, setColor] = useState('#22c55e');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const monthRange = getMonthRange();

    const [{ data: cats }, { data: expenses }] = await Promise.all([
      supabase.from('categories').select('*').eq('user_id', user.id).order('name'),
      supabase.from('expenses').select('amount, category_id').eq('user_id', user.id)
        .gte('date', monthRange.start).lte('date', monthRange.end),
    ]);

    const spendMap: Record<string, number> = {};
    expenses?.forEach(e => {
      if (e.category_id) {
        spendMap[e.category_id] = (spendMap[e.category_id] || 0) + Number(e.amount);
      }
    });
    setSpending(spendMap);

    if (cats) {
      const parentCats = cats.filter(c => !c.parent_id).map(c => ({
        ...c,
        subcategories: cats.filter(sc => sc.parent_id === c.id),
      }));
      setCategories(parentCats);
    }
    setLoading(false);
  }

  function openForm(category?: Category, asSubcategoryOf?: string) {
    if (category) {
      setEditingId(category.id);
      setName(category.name);
      setIcon(category.icon);
      setColor(category.color);
      setBudgetAmount(category.budget_amount > 0 ? String(category.budget_amount) : '');
      setBudgetPeriod(category.budget_period);
      setParentId(category.parent_id);
    } else {
      setEditingId(null);
      setName('');
      setIcon('📦');
      setColor(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
      setBudgetAmount('');
      setBudgetPeriod('monthly');
      setParentId(asSubcategoryOf || null);
    }
    setShowForm(true);
  }

  async function handleSave() {
    if (!name) return;
    setSaving(true);

    const data = {
      user_id: user.id,
      name,
      icon,
      color,
      budget_amount: budgetAmount ? parseFloat(budgetAmount) : 0,
      budget_period: budgetPeriod,
      parent_id: parentId,
    };

    try {
      if (editingId) {
        await supabase.from('categories').update(data).eq('id', editingId);
      } else {
        await supabase.from('categories').insert(data);
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
    if (confirm('¿Eliminar esta categoría? Los gastos asociados quedarán sin categoría.')) {
      await supabase.from('categories').delete().eq('id', id);
      loadData();
    }
  }

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto page-transition">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Categorías</h1>
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
      ) : categories.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-5xl mb-4">📂</div>
          <p className="text-dark-300 font-medium">No tenés categorías</p>
          <p className="text-dark-500 text-sm mt-1">Crealas para organizar tus gastos</p>
          <button
            onClick={() => openForm()}
            className="mt-4 bg-brand-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl"
          >
            Crear primera categoría
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {categories.map((cat) => {
            const catSpent = spending[cat.id] || 0;
            const subSpent = (cat.subcategories || []).reduce((s, sc) => s + (spending[sc.id] || 0), 0);
            const totalSpent = catSpent + subSpent;
            const pct = cat.budget_amount > 0 ? (totalSpent / cat.budget_amount) * 100 : 0;
            const hasSubs = (cat.subcategories?.length || 0) > 0;

            return (
              <div key={cat.id} className="bg-dark-800 rounded-xl overflow-hidden">
                {/* Parent category */}
                <div className="p-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                        style={{ backgroundColor: cat.color + '20' }}
                      >
                        {cat.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{cat.name}</p>
                        <div className="flex items-center gap-2 text-xs text-dark-400">
                          <span>{formatCurrency(totalSpent)}</span>
                          {cat.budget_amount > 0 && (
                            <span>/ {formatCurrency(cat.budget_amount)} {cat.budget_period === 'monthly' ? 'mes' : 'año'}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openForm(undefined, cat.id)}
                        className="p-2 text-dark-400 hover:text-dark-200"
                        title="Agregar subcategoría"
                      >
                        <FolderPlus size={14} />
                      </button>
                      <button onClick={() => openForm(cat)} className="p-2 text-dark-400 hover:text-dark-200">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => handleDelete(cat.id)} className="p-2 text-dark-400 hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {cat.budget_amount > 0 && (
                    <div className="mt-2 w-full bg-dark-700 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(pct, 100)}%`,
                          backgroundColor: pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : cat.color,
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Subcategories - always visible */}
                {hasSubs && (
                  <div className="border-t border-dark-700/50">
                    <div className="px-3.5 pt-2 pb-1">
                      <span className="text-[10px] uppercase tracking-wider text-dark-500 font-semibold">Subcategorías</span>
                    </div>
                    {cat.subcategories!.map((sub, idx) => {
                      const subS = spending[sub.id] || 0;
                      const subPct = sub.budget_amount > 0 ? (subS / Number(sub.budget_amount)) * 100 : 0;
                      const isLast = idx === cat.subcategories!.length - 1;
                      return (
                        <div
                          key={sub.id}
                          className={`flex items-center justify-between pl-5 pr-3.5 py-2.5 ${!isLast ? 'border-b border-dark-700/20' : ''}`}
                        >
                          <div className="flex items-center gap-2.5 flex-1 min-w-0">
                            <div className="text-dark-500 text-xs">└</div>
                            <div
                              className="w-7 h-7 rounded-md flex items-center justify-center text-sm flex-shrink-0"
                              style={{ backgroundColor: (sub.color || cat.color) + '15' }}
                            >
                              {sub.icon}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-dark-200">{sub.name}</p>
                              <p className="text-xs text-dark-400">
                                {formatCurrency(subS)}
                                {sub.budget_amount > 0 && ` / ${formatCurrency(Number(sub.budget_amount))} ${sub.budget_period === 'monthly' ? 'mes' : 'año'}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => openForm(sub)} className="p-1.5 text-dark-400 hover:text-dark-200">
                              <Edit3 size={13} />
                            </button>
                            <button onClick={() => handleDelete(sub.id)} className="p-1.5 text-dark-400 hover:text-red-400">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Form Modal - Wallet style */}
      {showForm && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-5 pb-3">
            <button onClick={() => setShowForm(false)} className="p-1 text-dark-400 hover:text-white">
              <X size={24} />
            </button>
            <h2 className="text-base font-bold">
              {editingId ? 'Editar categoría' : parentId ? 'Nueva subcategoría' : 'Crear categoría'}
            </h2>
            <div className="w-8" />
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-28">
            {/* Preview: icon circle + name */}
            <div className="flex items-center gap-4 py-5">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-3xl flex-shrink-0 transition-colors"
                style={{ backgroundColor: color }}
              >
                {icon}
              </div>
              <div
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setName((e.target as HTMLDivElement).textContent || '')}
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                data-placeholder="Nombre de categoría"
                className="flex-1 text-lg font-semibold focus:outline-none border-b border-dark-700 pb-2 empty:before:content-[attr(data-placeholder)] empty:before:text-dark-500 min-h-[28px]"
                role="textbox"
              >
                {editingId ? name : ''}
              </div>
            </div>

            {/* Budget */}
            <div className="mb-5">
              <p className="text-xs text-dark-400 font-medium mb-2 uppercase tracking-wider">Presupuesto</p>
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400 text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={budgetAmount}
                    onChange={(e) => setBudgetAmount(e.target.value)}
                    className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 pl-8 pr-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                  />
                </div>
                <div className="flex bg-dark-800 rounded-xl p-0.5 border border-dark-700">
                  <button
                    onClick={() => setBudgetPeriod('monthly')}
                    className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                      budgetPeriod === 'monthly' ? 'bg-dark-600 text-white' : 'text-dark-400'
                    }`}
                  >
                    Mes
                  </button>
                  <button
                    onClick={() => setBudgetPeriod('yearly')}
                    className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                      budgetPeriod === 'yearly' ? 'bg-dark-600 text-white' : 'text-dark-400'
                    }`}
                  >
                    Año
                  </button>
                </div>
              </div>
            </div>

            {/* Color picker - small, scrollable */}
            <div className="mb-5">
              <p className="text-xs text-dark-400 font-medium mb-2.5 uppercase tracking-wider">Color</p>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full flex-shrink-0 transition-all ${
                      color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-dark-900 scale-110' : ''
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Icon picker - 6 col grid */}
            <div>
              <p className="text-xs text-dark-400 font-medium mb-2.5 uppercase tracking-wider">Ícono</p>
              <div className="grid grid-cols-6 gap-2">
                {CATEGORY_ICONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setIcon(ic)}
                    className={`aspect-square rounded-xl flex items-center justify-center text-xl transition-all ${
                      icon === ic
                        ? 'bg-dark-600 ring-2 ring-brand-500'
                        : 'bg-dark-800 hover:bg-dark-700'
                    }`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Create button - part of the flex column, not fixed/sticky */}
          <div className="px-4 py-4 bg-dark-900 border-t border-dark-800">
            <button
              onClick={handleSave}
              disabled={saving || !name}
              className="w-full py-4 rounded-2xl font-bold text-base transition-all disabled:opacity-30"
              style={{ backgroundColor: color, color: 'white' }}
            >
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear categoría'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
