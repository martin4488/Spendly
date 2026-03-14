'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getBudgetPeriodRange } from '@/lib/utils';
import { Budget, Category, Expense } from '@/types';
import { ArrowLeft, MoreHorizontal, Edit3, Trash2, X, DollarSign, ChevronRight } from 'lucide-react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const DONUT_COLORS = [
  '#3b82f6', '#f97316', '#22c55e', '#eab308', '#8b5cf6',
  '#ec4899', '#14b8a6', '#ef4444', '#06b6d4', '#a855f7',
];

type SubView = 'detail' | 'overview';

interface Props {
  user: User;
  budget: Budget;
  onBack: () => void;
  onRefresh: () => void;
}

interface CatSpend {
  id: string;
  name: string;
  icon: string;
  color: string;
  spent: number;
  percentage: number;
  transactions: number;
}

export default function BudgetDetailView({ user, budget, onBack, onRefresh }: Props) {
  const [subView, setSubView] = useState<SubView>('detail');
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [catSpending, setCatSpending] = useState<CatSpend[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);

  // Edit form
  const [showEditForm, setShowEditForm] = useState(false);
  const [editName, setEditName] = useState(budget.name);
  const [editAmount, setEditAmount] = useState(String(budget.amount));
  const [editRecurrence, setEditRecurrence] = useState(budget.recurrence);
  const [editStartDate, setEditStartDate] = useState(budget.start_date);
  const [editCatIds, setEditCatIds] = useState<string[]>(budget.category_ids || []);
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);

  const range = getBudgetPeriodRange(budget.start_date, budget.recurrence);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: catsData }, { data: bcData }] = await Promise.all([
        supabase.from('categories').select('*').eq('user_id', user.id).order('name'),
        supabase.from('budget_categories').select('*').eq('budget_id', budget.id),
      ]);

      const allCats = catsData || [];
      setAllCategories(allCats);

      const catIds = (bcData || []).map(bc => bc.category_id);
      setEditCatIds(catIds);

      // Include subcategory IDs
      const allCatIds = [...catIds];
      allCats.forEach(c => {
        if (c.parent_id && catIds.includes(c.parent_id) && !allCatIds.includes(c.id)) {
          allCatIds.push(c.id);
        }
      });

      const budgetCats = allCats.filter(c => allCatIds.includes(c.id));
      setCategories(budgetCats);

      // Fetch expenses
      let expensesData: Expense[] = [];
      if (allCatIds.length > 0) {
        const { data: exp } = await supabase
          .from('expenses')
          .select('*, category:categories(*)')
          .eq('user_id', user.id)
          .in('category_id', allCatIds)
          .gte('date', range.start)
          .lte('date', range.end)
          .order('date', { ascending: false });
        expensesData = exp || [];
      }

      setExpenses(expensesData);

      const total = expensesData.reduce((sum, e) => sum + Number(e.amount), 0);
      setTotalSpent(total);

      // Category spending breakdown (parent-level)
      const parentCats = allCats.filter(c => catIds.includes(c.id) && !c.parent_id);
      const spending: CatSpend[] = parentCats.map((cat, idx) => {
        const subIds = allCats.filter(sc => sc.parent_id === cat.id).map(sc => sc.id);
        const catExpIds = [cat.id, ...subIds];
        const catExps = expensesData.filter(e => e.category_id && catExpIds.includes(e.category_id));
        const spent = catExps.reduce((sum, e) => sum + Number(e.amount), 0);
        return {
          id: cat.id,
          name: cat.name,
          icon: cat.icon,
          color: DONUT_COLORS[idx % DONUT_COLORS.length],
          spent,
          percentage: total > 0 ? (spent / total) * 100 : 0,
          transactions: catExps.length,
        };
      }).filter(c => c.spent > 0)
        .sort((a, b) => b.spent - a.spent);

      setCatSpending(spending);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit() {
    setSaving(true);
    try {
      await supabase.from('budgets').update({
        name: editName,
        amount: parseFloat(editAmount),
        recurrence: editRecurrence,
        start_date: editStartDate,
      }).eq('id', budget.id);

      await supabase.from('budget_categories').delete().eq('budget_id', budget.id);
      if (editCatIds.length > 0) {
        await supabase.from('budget_categories').insert(
          editCatIds.map(cid => ({ budget_id: budget.id, category_id: cid }))
        );
      }

      setShowEditForm(false);
      onRefresh();
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (confirm('¿Eliminar este presupuesto?')) {
      await supabase.from('budgets').delete().eq('id', budget.id);
      onBack();
    }
  }

  function toggleCat(catId: string) {
    setEditCatIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    );
  }

  const left = Math.max(budget.amount - totalSpent, 0);
  const pct = budget.amount > 0 ? (totalSpent / budget.amount) * 100 : 0;
  const today = new Date();
  const endDate = new Date(range.end + 'T00:00');
  const daysLeft = Math.max(differenceInDays(endDate, today), 1);
  const perDay = left / daysLeft;

  const startLabel = format(new Date(range.start + 'T00:00'), "MMMM d, yyyy", { locale: es });
  const endLabel = format(new Date(range.end + 'T00:00'), "MMMM d, yyyy", { locale: es });

  // Progress bar position for "Today"
  const totalDays = differenceInDays(endDate, new Date(range.start + 'T00:00'));
  const daysPassed = differenceInDays(today, new Date(range.start + 'T00:00'));
  const timeProgress = totalDays > 0 ? Math.min(Math.max((daysPassed / totalDays) * 100, 0), 100) : 0;

  const donutData = catSpending.map(c => ({ name: c.name, value: c.spent, color: c.color }));

  // Group expenses by day for transactions list
  const dayMap = new Map<string, Expense[]>();
  expenses.forEach(exp => {
    if (!dayMap.has(exp.date)) dayMap.set(exp.date, []);
    dayMap.get(exp.date)!.push(exp);
  });
  const todayStr = format(today, 'yyyy-MM-dd');
  const yesterdayStr = format(new Date(today.getTime() - 86400000), 'yyyy-MM-dd');

  const groupedByDay = Array.from(dayMap.entries())
    .map(([dateStr, exps]) => ({
      date: dateStr,
      label: dateStr === todayStr ? 'Hoy' : dateStr === yesterdayStr ? 'Ayer' : format(parseISO(dateStr), "MMMM d", { locale: es }),
      total: exps.reduce((sum, e) => sum + Number(e.amount), 0),
      expenses: exps,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const parentCatsForPicker = allCategories.filter(c => !c.parent_id);
  const getSubcatsForPicker = (pid: string) => allCategories.filter(c => c.parent_id === pid);
  const recurrenceLabels: Record<string, string> = { monthly: 'Mensual', yearly: 'Anual' };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto page-transition pb-24">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <button onClick={onBack} className="p-1 text-dark-300 hover:text-white transition-colors">
          <ArrowLeft size={22} />
        </button>
        <div className="text-center">
          <h1 className="text-lg font-bold">{budget.name}</h1>
          <p className="text-[10px] text-dark-500 capitalize">{startLabel} - {endLabel}</p>
        </div>
        <button onClick={() => setShowMenu(!showMenu)} className="p-1 text-dark-400 hover:text-white relative">
          <MoreHorizontal size={22} />
          {showMenu && (
            <div className="absolute right-0 top-8 bg-dark-800 border border-dark-700 rounded-xl shadow-xl z-10 w-44 overflow-hidden">
              <button
                onClick={() => { setShowMenu(false); setShowEditForm(true); }}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-dark-700 transition-colors"
              >
                <Edit3 size={14} /> Editar
              </button>
              <button
                onClick={() => { setShowMenu(false); handleDelete(); }}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-dark-700 transition-colors"
              >
                <Trash2 size={14} /> Eliminar
              </button>
            </div>
          )}
        </button>
      </div>

      {/* Sub-navigation */}
      <div className="flex justify-center mb-4 mt-1">
        <div className="inline-flex bg-dark-800 rounded-full p-0.5">
          <button
            onClick={() => setSubView('detail')}
            className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${
              subView === 'detail' ? 'bg-dark-600 text-white shadow-sm' : 'text-dark-400'
            }`}
          >
            Detalle
          </button>
          <button
            onClick={() => setSubView('overview')}
            className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${
              subView === 'overview' ? 'bg-dark-600 text-white shadow-sm' : 'text-dark-400'
            }`}
          >
            Overview
          </button>
        </div>
      </div>

      {subView === 'detail' ? (
        /* ======= DETAIL VIEW ======= */
        <div className="px-4">
          {/* Big amount */}
          <div className="text-center mb-4">
            <p className={`text-3xl font-extrabold ${pct >= 100 ? 'text-red-400' : 'text-brand-400'}`}>
              {formatCurrency(left)}
            </p>
            <p className="text-dark-500 text-sm mt-0.5">restante de {formatCurrency(budget.amount)}</p>
          </div>

          {/* Daily spend advice */}
          <div className="bg-brand-500/8 border border-brand-500/15 rounded-2xl px-4 py-3.5 mb-5">
            <p className="text-sm text-dark-200">
              {pct >= 100
                ? '¡Ya superaste el presupuesto!'
                : <>Podés gastar <span className="font-bold text-brand-400">{formatCurrency(perDay)}</span> por día durante los próximos {daysLeft} días.</>
              }
            </p>
          </div>

          {/* Timeline progress */}
          <div className="mb-5">
            <div className="relative">
              {/* Today marker */}
              <div
                className="absolute -top-5 flex flex-col items-center"
                style={{ left: `${timeProgress}%`, transform: 'translateX(-50%)' }}
              >
                <span className="text-[9px] font-bold bg-dark-700 text-white px-1.5 py-0.5 rounded">Hoy</span>
                <div className="w-px h-2 bg-dark-500" />
              </div>
              {/* Bar */}
              <div className="w-full bg-dark-700 rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(pct, 100)}%`,
                    backgroundColor: pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e',
                  }}
                />
              </div>
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-dark-500 capitalize">
                {format(new Date(range.start + 'T00:00'), "MMM d", { locale: es })}
              </span>
              <span
                className={`text-[10px] font-bold ${pct >= 100 ? 'text-red-400' : 'text-brand-400'}`}
              >
                {pct.toFixed(1)}%
              </span>
              <span className="text-[10px] text-dark-500 capitalize">
                {format(new Date(range.end + 'T00:00'), "MMM d", { locale: es })}
              </span>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-dark-800 rounded-xl p-3 text-center">
              <p className="text-[10px] text-dark-500 mb-0.5">Gastado</p>
              <p className="text-sm font-bold text-red-400">{formatCurrency(totalSpent)}</p>
            </div>
            <div className="bg-dark-800 rounded-xl p-3 text-center">
              <p className="text-[10px] text-dark-500 mb-0.5">Transacciones</p>
              <p className="text-sm font-bold">{expenses.length}</p>
            </div>
            <div className="bg-dark-800 rounded-xl p-3 text-center">
              <p className="text-[10px] text-dark-500 mb-0.5">Categorías</p>
              <p className="text-sm font-bold">{catSpending.length}</p>
            </div>
          </div>

          {/* Budget Overview link */}
          <button
            onClick={() => setSubView('overview')}
            className="w-full flex items-center justify-center gap-2 py-3 text-dark-300 hover:text-dark-100 transition-colors mb-2"
          >
            <span className="text-lg">📊</span>
            <span className="text-sm font-medium">Budget Overview</span>
            <ChevronRight size={14} className="text-dark-500" />
          </button>
        </div>
      ) : (
        /* ======= OVERVIEW VIEW ======= */
        <div>
          {/* Period label */}
          <p className="text-center text-sm text-dark-400 capitalize mb-3">
            {format(new Date(range.start + 'T00:00'), "MMMM d", { locale: es })} – {format(new Date(range.end + 'T00:00'), "MMMM d, yyyy", { locale: es })}
          </p>

          {/* ===== CATEGORIES SECTION ===== */}
          <div className="px-4 mb-3">
            <h2 className="text-lg font-bold mb-3">Categorías</h2>
          </div>

          {/* Donut chart */}
          {catSpending.length > 0 && (
            <div className="px-4 mb-2">
              <div className="relative">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {donutData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-1">
                {catSpending.map(cat => (
                  <div key={cat.id} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-[10px] text-dark-300">{cat.name} {cat.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Category list */}
          <div className="px-4 mb-5">
            {catSpending.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-3.5 py-3.5 border-b border-dark-800/50"
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                  style={{ backgroundColor: cat.color + '30' }}
                >
                  {cat.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold">{cat.name}</p>
                  <p className="text-[11px] text-dark-500 mt-0.5">
                    {cat.transactions} {cat.transactions === 1 ? 'transacción' : 'transacciones'}
                  </p>
                </div>
                <span className="text-[13px] font-bold text-red-400 flex-shrink-0">
                  -{formatCurrency(cat.spent)}
                </span>
              </div>
            ))}
            {catSpending.length === 0 && (
              <div className="text-center py-8">
                <p className="text-dark-500 text-sm">Sin gastos en este período</p>
              </div>
            )}
          </div>

          {/* ===== TRANSACTIONS SECTION ===== */}
          <div className="px-4 mb-2">
            <h2 className="text-lg font-bold">Transacciones</h2>
          </div>

          <div className="min-h-[120px]">
            {groupedByDay.length === 0 ? (
              <div className="text-center py-8 px-4">
                <p className="text-dark-500 text-sm">No hay transacciones</p>
              </div>
            ) : (
              groupedByDay.map((group) => (
                <div key={group.date}>
                  <div className="flex items-center justify-between px-4 py-2 bg-dark-900/60 border-t border-dark-800/80">
                    <span className="text-xs font-semibold text-dark-400 uppercase tracking-wide capitalize">{group.label}</span>
                    <span className="text-xs font-bold text-red-400">-{formatCurrency(group.total)}</span>
                  </div>
                  {group.expenses.map((expense) => {
                    const cat = (expense as any).category;
                    return (
                      <div
                        key={expense.id}
                        className="flex items-center gap-3.5 px-4 py-3 border-b border-dark-800/40"
                      >
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-base flex-shrink-0"
                          style={{ backgroundColor: cat?.color ? cat.color + '30' : '#47556930' }}
                        >
                          {cat?.icon || '💵'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate">{expense.description}</p>
                          <p className="text-[11px] text-dark-500 mt-0.5">
                            {cat?.name || 'Sin categoría'}
                          </p>
                        </div>
                        <span className="text-[13px] font-bold text-red-400 flex-shrink-0">
                          -{formatCurrency(Number(expense.amount))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===== EDIT FORM ===== */}
      {showEditForm && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3">
            <button onClick={() => setShowEditForm(false)} className="p-1 text-dark-400 hover:text-white">
              <X size={24} />
            </button>
            <h2 className="text-base font-bold">Editar presupuesto</h2>
            <button onClick={handleDelete} className="p-1 text-red-400 hover:text-red-300">
              🗑️
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-28 space-y-5">
            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Nombre</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Monto</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dark-400" />
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*\.?[0-9]*"
                  value={editAmount}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setEditAmount(val);
                  }}
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 pl-10 pr-4 text-lg font-semibold focus:outline-none focus:border-brand-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Recurrencia</label>
              <div className="flex bg-dark-800 rounded-xl p-1 border border-dark-700">
                {(['monthly', 'yearly'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setEditRecurrence(r)}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${
                      editRecurrence === r ? 'bg-brand-600 text-white shadow-lg' : 'text-dark-400'
                    }`}
                  >
                    {recurrenceLabels[r]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Fecha inicio</label>
              <input
                type="date"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">
                Categorías ({editCatIds.length})
              </label>
              <button
                onClick={() => setShowCatPicker(true)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 px-4 text-sm text-left flex items-center justify-between"
              >
                <span className={editCatIds.length > 0 ? 'text-white' : 'text-dark-500'}>
                  {editCatIds.length > 0
                    ? allCategories.filter(c => editCatIds.includes(c.id)).map(c => `${c.icon} ${c.name}`).join(', ')
                    : 'Seleccionar categorías...'
                  }
                </span>
                <ChevronRight size={16} className="text-dark-500" />
              </button>
            </div>
          </div>

          <div className="px-4 py-4 bg-dark-900 border-t border-dark-800">
            <button
              onClick={handleSaveEdit}
              disabled={saving || !editName || !editAmount}
              className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-30 text-white font-bold py-4 rounded-2xl transition-all text-base"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}

      {/* ===== CATEGORY PICKER (edit form) ===== */}
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
                  const allIds = allCategories.map(c => c.id);
                  if (editCatIds.length === allIds.length) {
                    setEditCatIds([]);
                  } else {
                    setEditCatIds(allIds);
                  }
                }}
                className="text-xs text-brand-400 font-medium"
              >
                {editCatIds.length === allCategories.length ? 'Ninguna' : 'Todas'}
              </button>
            </div>

            {parentCatsForPicker.map((cat) => {
              const isSelected = editCatIds.includes(cat.id);
              const subs = getSubcatsForPicker(cat.id);
              return (
                <div key={cat.id}>
                  <button
                    onClick={() => toggleCat(cat.id)}
                    className="w-full flex items-center gap-3 px-4 py-4 border-b border-dark-700/30 active:bg-dark-700/50"
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
                    const subSelected = editCatIds.includes(sub.id);
                    return (
                      <button
                        key={sub.id}
                        onClick={() => toggleCat(sub.id)}
                        className="w-full flex items-center gap-3 pl-10 pr-4 py-3 border-b border-dark-700/20 active:bg-dark-700/50"
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
