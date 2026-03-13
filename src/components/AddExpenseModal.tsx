'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Category } from '@/types';
import { X, DollarSign, FileText, Calendar } from 'lucide-react';

interface Props {
  user: User;
  onClose: () => void;
  onSaved: () => void;
  editingExpense?: {
    id: string;
    amount: number;
    description: string;
    category_id: string | null;
    date: string;
  } | null;
}

export default function AddExpenseModal({ user, onClose, onSaved, editingExpense }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [amount, setAmount] = useState(editingExpense ? String(editingExpense.amount) : '');
  const [description, setDescription] = useState(editingExpense?.description || '');
  const [categoryId, setCategoryId] = useState(editingExpense?.category_id || '');
  const [date, setDate] = useState(editingExpense?.date || new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from('categories')
      .select('*')
      .eq('user_id', user.id)
      .order('name')
      .then(({ data }) => setCategories(data || []));
  }, [user.id]);

  async function handleSave() {
    if (!amount) return;
    setSaving(true);

    const data = {
      user_id: user.id,
      amount: parseFloat(amount),
      description: description || 'Gasto',
      notes: null,
      category_id: categoryId || null,
      date,
    };

    try {
      if (editingExpense) {
        await supabase.from('expenses').update(data).eq('id', editingExpense.id);
      } else {
        await supabase.from('expenses').insert(data);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // Group categories: parents first, then their children indented
  const parentCats = categories.filter(c => !c.parent_id);
  const getSubcats = (parentId: string) => categories.filter(c => c.parent_id === parentId);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end">
      <div className="bg-dark-800 w-full rounded-t-3xl p-5 slide-up max-w-lg mx-auto max-h-[85vh] overflow-y-auto pb-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">{editingExpense ? 'Editar gasto' : 'Nuevo gasto'}</h2>
          <button onClick={onClose} className="text-dark-400 p-1">
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

          {/* Description (optional) */}
          <div>
            <label className="text-xs text-dark-400 font-medium mb-1.5 block">Descripción (opcional)</label>
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

          {/* Category with subcategories */}
          <div>
            <label className="text-xs text-dark-400 font-medium mb-1.5 block">Categoría</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors appearance-none"
            >
              <option value="">Sin categoría</option>
              {parentCats.map((cat) => {
                const subs = getSubcats(cat.id);
                return (
                  <optgroup key={cat.id} label={`${cat.icon} ${cat.name}`}>
                    <option value={cat.id}>{cat.icon} {cat.name} (general)</option>
                    {subs.map((sub) => (
                      <option key={sub.id} value={sub.id}>↳ {sub.icon} {sub.name}</option>
                    ))}
                  </optgroup>
                );
              })}
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

          {/* Submit - with extra bottom margin to avoid being hidden */}
          <div className="pt-2 pb-4">
            <button
              onClick={handleSave}
              disabled={saving || !amount}
              className="w-full bg-brand-600 hover:bg-brand-500 disabled:bg-dark-600 text-white font-semibold py-3.5 rounded-xl transition-all text-sm"
            >
              {saving ? 'Guardando...' : editingExpense ? 'Guardar cambios' : 'Agregar gasto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
