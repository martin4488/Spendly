'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, CATEGORY_ICONS, CATEGORY_COLORS } from '@/lib/utils';
import { Category } from '@/types';
import { Plus, Edit3, Trash2, X, ChevronDown, ChevronRight, FolderPlus } from 'lucide-react';

export default function CategoriesView({ user }: { user: User }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
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
    const { data: cats } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', user.id)
      .order('name');

    // Get this month's spending per category
    const monthRange = getMonthRange();
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, category_id')
      .eq('user_id', user.id)
      .gte('date', monthRange.start)
      .lte('date', monthRange.end);

    const spendMap: Record<string, number> = {};
    expenses?.forEach(e => {
      if (e.category_id) {
        spendMap[e.category_id] = (spendMap[e.category_id] || 0) + Number(e.amount);
      }
    });
    setSpending(spendMap);

    // Build tree
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

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        <div className="space-y-2">
          {categories.map((cat) => {
            const isExpanded = expandedIds.has(cat.id);
            const catSpent = spending[cat.id] || 0;
            const subSpent = (cat.subcategories || []).reduce((s, sc) => s + (spending[sc.id] || 0), 0);
            const totalSpent = catSpent + subSpent;
            const pct = cat.budget_amount > 0 ? (totalSpent / cat.budget_amount) * 100 : 0;

            return (
              <div key={cat.id}>
                <div className="bg-dark-800 rounded-xl p-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0" onClick={() => toggleExpand(cat.id)}>
                      {(cat.subcategories?.length || 0) > 0 && (
                        <button className="text-dark-400">
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      )}
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

                {/* Subcategories */}
                {isExpanded && cat.subcategories && cat.subcategories.length > 0 && (
                  <div className="ml-6 mt-1 space-y-1">
                    {cat.subcategories.map((sub) => {
                      const subS = spending[sub.id] || 0;
                      return (
                        <div key={sub.id} className="bg-dark-800/60 rounded-xl p-3 flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className="text-base">{sub.icon}</span>
                            <div>
                              <p className="text-sm font-medium">{sub.name}</p>
                              <p className="text-xs text-dark-400">
                                {formatCurrency(subS)}
                                {sub.budget_amount > 0 && ` / ${formatCurrency(sub.budget_amount)}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
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

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end">
          <div className="bg-dark-800 w-full rounded-t-3xl p-5 slide-up max-w-lg mx-auto max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">
                {editingId ? 'Editar categoría' : parentId ? 'Nueva subcategoría' : 'Nueva categoría'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-dark-400 p-1"><X size={22} /></button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Nombre *</label>
                <input
                  type="text"
                  placeholder="Ej: Comida, Transporte, Entretenimiento..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-xl py-3 px-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                  autoFocus
                />
              </div>

              {/* Icon picker */}
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Ícono</label>
                <div className="grid grid-cols-10 gap-1">
                  {CATEGORY_ICONS.map((ic) => (
                    <button
                      key={ic}
                      onClick={() => setIcon(ic)}
                      className={`text-xl p-1.5 rounded-lg transition-all ${
                        icon === ic ? 'bg-dark-600 scale-110' : 'hover:bg-dark-700'
                      }`}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="text-xs text-dark-400 font-medium mb-1.5 block">Color</label>
                <div className="grid grid-cols-10 gap-1.5">
                  {CATEGORY_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full transition-all ${
                        color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-dark-800 scale-110' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Budget */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-dark-400 font-medium mb-1.5 block">Presupuesto</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={budgetAmount}
                    onChange={(e) => setBudgetAmount(e.target.value)}
                    className="w-full bg-dark-700 border border-dark-600 rounded-xl py-3 px-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs text-dark-400 font-medium mb-1.5 block">Período</label>
                  <select
                    value={budgetPeriod}
                    onChange={(e) => setBudgetPeriod(e.target.value as any)}
                    className="w-full bg-dark-700 border border-dark-600 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors appearance-none"
                  >
                    <option value="monthly">Mensual</option>
                    <option value="yearly">Anual</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleSave}
                disabled={saving || !name}
                className="w-full bg-brand-600 hover:bg-brand-500 disabled:bg-dark-600 text-white font-semibold py-3.5 rounded-xl transition-all text-sm"
              >
                {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear categoría'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
