'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getBudgetPeriodRange } from '@/lib/utils';
import { Budget, Category } from '@/types';
import { Plus, X, ChevronRight, Delete, ArrowLeft, Search, Check } from 'lucide-react';
import {
  format, addMonths, addYears, startOfMonth, endOfMonth,
  startOfYear, endOfYear, parseISO, isBefore, isAfter
} from 'date-fns';
import { es } from 'date-fns/locale';

interface Props {
  user: User;
  onOpenBudget: (budget: Budget, periodId?: string) => void;
  onOpenGlobalBudget: () => void;
}

export interface BudgetPeriod {
  id: string;
  budget_id: string;
  period_start: string;
  period_end: string;
  amount?: number;
}

import { CatNode, FlatEntry, buildTree, flattenTree, allDescendantIds } from '@/lib/categoryTree';

// ── Period generation ─────────────────────────────────────────────────────────
function getPeriodBounds(startDate: string, recurrence: 'monthly' | 'yearly', offset: number = 0): { start: string; end: string } {
  const base = parseISO(startDate);
  let periodStart: Date;
  let periodEnd: Date;

  if (recurrence === 'monthly') {
    periodStart = startOfMonth(addMonths(base, offset));
    periodEnd = endOfMonth(addMonths(base, offset));
  } else {
    periodStart = startOfYear(addYears(base, offset));
    periodEnd = endOfYear(addYears(base, offset));
  }

  return {
    start: format(periodStart, 'yyyy-MM-dd'),
    end: format(periodEnd, 'yyyy-MM-dd'),
  };
}

// Generate all period ranges from budget start_date up to today
function generateMissingPeriods(budget: Budget, existingPeriods: BudgetPeriod[]): { start: string; end: string }[] {
  const today = format(new Date(), 'yyyy-MM-dd');
  const missing: { start: string; end: string }[] = [];
  let offset = 0;

  while (true) {
    const bounds = getPeriodBounds(budget.start_date, budget.recurrence as 'monthly' | 'yearly', offset);
    if (bounds.start > today) break;

    const exists = existingPeriods.some(p => p.period_start === bounds.start && p.budget_id === budget.id);
    if (!exists) missing.push(bounds);

    offset++;
    if (offset > 120) break; // safety cap: 10 years
  }

  return missing;
}

export default function BudgetsView({ user, onOpenBudget, onOpenGlobalBudget }: Props) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [roots, setRoots] = useState<CatNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [currentPeriods, setCurrentPeriods] = useState<Record<string, BudgetPeriod>>({});
  const [monthlyBudget, setMonthlyBudget] = useState<number | null>(null);
  const [globalStats, setGlobalStats] = useState<{ spent: number; prevSpent: number } | null>(null);
  const [globalAccumulated, setGlobalAccumulated] = useState<number | null>(null);
  const [globalAccumMonths, setGlobalAccumMonths] = useState<string>('');
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetStartMonth, setBudgetStartMonth] = useState(format(startOfMonth(new Date()), 'yyyy-MM'));

  // Form state
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [recurrence, setRecurrence] = useState<'monthly' | 'yearly'>('monthly');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedCatIds, setSelectedCatIds] = useState<string[]>([]);
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  function handleNumpad(key: string) {
    if (key === 'backspace') { setAmount(prev => prev.slice(0, -1)); }
    else if (key === '.') { if (!amount.includes('.')) setAmount(prev => (prev || '0') + '.'); }
    else {
      if (amount.includes('.')) { const d = amount.split('.')[1]; if (d && d.length >= 2) return; }
      setAmount(prev => prev + key);
    }
  }

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');

      // Roundtrip 1a: budgets + categories (indexed by user_id)
      const [{ data: budgetsData }, { data: catsData }] = await Promise.all([
        supabase.from('budgets').select('*').eq('user_id', user.id).order('name'),
        supabase.from('categories').select('*').eq('user_id', user.id).neq('deleted', true).order('position').order('created_at'),
      ]);
      const budgetIds = (budgetsData || []).map((b: any) => b.id);

      // Roundtrip 1b: bc + periods filtered by budget IDs — fire immediately after budgetIds known,
      // overlaps with the in-memory work below so effectively free
      const [{ data: bcData }, { data: periodsData }] = budgetIds.length > 0
        ? await Promise.all([
            supabase.from('budget_categories').select('*').in('budget_id', budgetIds),
            supabase.from('budget_periods').select('id, budget_id, period_start, period_end, amount').in('budget_id', budgetIds),
          ])
        : [{ data: [] as any[] }, { data: [] as any[] }];

      const allBudgets = budgetsData || [];
      const allCats = catsData || [];
      const allPeriods = periodsData || [];
      setCategories(allCats);
      const tree = buildTree(allCats);
      setRoots(tree);

      // Index bcData and periods by budget_id up front
      const bcByBudget: Record<string, string[]> = {};
      (bcData || []).forEach((bc: any) => {
        if (!bcByBudget[bc.budget_id]) bcByBudget[bc.budget_id] = [];
        bcByBudget[bc.budget_id].push(bc.category_id);
      });
      const periodsByBudget: Record<string, BudgetPeriod[]> = {};
      allPeriods.forEach((p: BudgetPeriod) => {
        if (!periodsByBudget[p.budget_id]) periodsByBudget[p.budget_id] = [];
        periodsByBudget[p.budget_id].push(p);
      });

      // Batch-insert any missing periods, inheriting amount from most recent existing period
      const missingInserts: { budget_id: string; period_start: string; period_end: string; amount?: number }[] = [];
      for (const b of allBudgets) {
        const existing = (periodsByBudget[b.id] || []).sort((a: BudgetPeriod, b: BudgetPeriod) => b.period_start.localeCompare(a.period_start));
        const lastAmount = existing.find((p: BudgetPeriod) => p.amount != null)?.amount ?? null;
        generateMissingPeriods(b as Budget, periodsByBudget[b.id] || []).forEach(m => {
          const insert: { budget_id: string; period_start: string; period_end: string; amount?: number } = { budget_id: b.id, period_start: m.start, period_end: m.end };
          if (lastAmount != null) insert.amount = lastAmount;
          missingInserts.push(insert);
        });
      }
      if (missingInserts.length > 0) {
        const { data: newPeriods } = await supabase.from('budget_periods').insert(missingInserts).select();
        if (newPeriods) newPeriods.forEach((p: BudgetPeriod) => {
          if (!periodsByBudget[p.budget_id]) periodsByBudget[p.budget_id] = [];
          periodsByBudget[p.budget_id].push(p);
          allPeriods.push(p);
        });
      }

      // Current period per budget
      const curPeriods: Record<string, BudgetPeriod> = {};
      for (const b of allBudgets) {
        const cur = (periodsByBudget[b.id] || []).find(
          (p: BudgetPeriod) => p.period_start <= today && p.period_end >= today
        );
        if (cur) curPeriods[b.id] = cur;
      }
      setCurrentPeriods(curPeriods);

      // Expand category IDs for each budget using Set for O(1)
      const budgetCatSetMap: Record<string, Set<string>> = {};
      const budgetCatMap: Record<string, string[]> = {};
      for (const b of allBudgets) {
        const catIds = bcByBudget[b.id] || [];
        const expandedSet = new Set<string>(catIds);
        const addDesc = (nodes: CatNode[]) => {
          nodes.forEach(n => {
            if (expandedSet.has(n.id)) allDescendantIds(n).forEach(id => expandedSet.add(id));
            addDesc(n.children);
          });
        };
        addDesc(tree);
        budgetCatSetMap[b.id] = expandedSet;
        budgetCatMap[b.id] = Array.from(expandedSet);
      }

      // Show budgets immediately with spent=0 so UI appears fast, then fill in spending
      const enrichedPartial: Budget[] = allBudgets.map(b => {
        const catIds = bcByBudget[b.id] || [];
        const bCats = allCats.filter(c => catIds.includes(c.id));
        return { ...b, category_ids: catIds, categories: bCats, spent: 0, prevAccumulated: null } as any;
      });
      setBudgets(enrichedPartial);
      setLoading(false);

      // Load global budget from global_budget_periods
      const curMonth = format(new Date(), 'yyyy-MM');
      supabase.from('global_budget_periods').select('month, amount').eq('user_id', user.id)
        .then(({ data }) => {
          if (!data || data.length === 0) return;
          const sorted = [...data].sort((a, b) => b.month.localeCompare(a.month));
          // Current month budget (or most recent)
          const cur = sorted.find(p => p.month === curMonth) || sorted[0];
          if (cur) setMonthlyBudget(Number(cur.amount));
          // Accumulated from closed months this year (budget - spent will be loaded via globalStats)
        });

      // Load global month stats + accumulated
      const now2 = new Date();
      const curMonth2 = format(now2, 'yyyy-MM');
      const yearStart = `${now2.getFullYear()}-01-01`;
      const curMonthStart = format(startOfMonth(now2), 'yyyy-MM-dd');
      const curMonthEnd = format(endOfMonth(now2), 'yyyy-MM-dd');

      // Load all expenses this year + global_budget_periods for accumulation
      Promise.all([
        supabase.from('expenses').select('amount, date').eq('user_id', user.id).gte('date', yearStart).lte('date', curMonthEnd),
        supabase.from('global_budget_periods').select('month, amount').eq('user_id', user.id),
      ]).then(([{ data: expRows }, { data: periods }]) => {
        const rows = expRows || [];
        const curSpent = rows.filter(e => e.date >= curMonthStart && e.date <= curMonthEnd).reduce((s, e) => s + Number(e.amount), 0);
        setGlobalStats({ spent: curSpent, prevSpent: 0 });

        // Compute accumulated for closed months this year
        if (periods && periods.length > 0) {
          const cur = (periods as any[]).find(p => p.month === curMonth2);
          if (cur) setMonthlyBudget(Number(cur.amount));
          const closedMonths = (periods as any[]).filter(p => p.month < curMonth2 && p.month >= `${now2.getFullYear()}-01`);
          let acc = 0;
          closedMonths.forEach(p => {
            const mStart = `${p.month}-01`;
            const mEnd = format(endOfMonth(new Date(`${p.month}-01`)), 'yyyy-MM-dd');
            const mSpent = rows.filter(e => e.date >= mStart && e.date <= mEnd).reduce((s, e) => s + Number(e.amount), 0);
            acc += Number(p.amount) - mSpent;
          });
          if (closedMonths.length > 0) {
            setGlobalAccumulated(acc);
            const sorted = [...closedMonths].sort((a, b) => a.month.localeCompare(b.month));
            const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
            const first = cap(format(new Date(`${sorted[0].month}-01`), 'MMM', { locale: es }));
            const last = cap(format(new Date(`${sorted[sorted.length - 1].month}-01`), 'MMM', { locale: es }));
            setGlobalAccumMonths(first === last ? first : `${first} - ${last}`);
          }
        }
      });

      // Roundtrip 2: expenses — loads in background, UI already visible
      const allExpandedCatIds = Array.from(new Set(Object.values(budgetCatMap).flat()));
      const globalMinDate = allBudgets.reduce((min, b) => b.start_date < min ? b.start_date : min, today);
      const expByCat: Record<string, { amount: number; date: string }[]> = {};
      if (allExpandedCatIds.length > 0) {
        const { data: expData } = await supabase
          .from('expenses')
          .select('category_id, amount, date')
          .eq('user_id', user.id)
          .in('category_id', allExpandedCatIds)
          .gte('date', globalMinDate)
          .lte('date', today);
        (expData || []).forEach((e: any) => {
          if (!expByCat[e.category_id]) expByCat[e.category_id] = [];
          expByCat[e.category_id].push({ amount: Number(e.amount), date: e.date });
        });
      }

      const enriched: Budget[] = allBudgets.map(b => {
        const catIds = (bcData || []).filter((bc: any) => bc.budget_id === b.id).map((bc: any) => bc.category_id);
        const bCats = allCats.filter(c => catIds.includes(c.id));
        const expandedSet = budgetCatSetMap[b.id] || new Set<string>();
        const curPeriod = curPeriods[b.id];
        let spent = 0;
        if (curPeriod && expandedSet.size > 0) {
          expandedSet.forEach(catId => {
            (expByCat[catId] || []).forEach(e => {
              if (e.date >= curPeriod.period_start && e.date <= curPeriod.period_end) spent += e.amount;
            });
          });
        }
        let prevAccumulated: number | null = null;
        let prevAccumMonths = '';
        if (b.recurrence === 'monthly' && curPeriod) {
          const curYear = new Date().getFullYear();
          const bPeriods = allPeriods.filter((p: BudgetPeriod) =>
            p.budget_id === b.id &&
            p.period_end < curPeriod.period_start &&
            p.period_start >= `${curYear}-01-01`
          );
          if (bPeriods.length > 0 && expandedSet.size > 0) {
            prevAccumulated = bPeriods.reduce((acc, p: BudgetPeriod) => {
              const pAmt = (p as any).amount ?? b.amount;
              let pSpent = 0;
              expandedSet.forEach(catId => {
                (expByCat[catId] || []).forEach(e => {
                  if (e.date >= p.period_start && e.date <= p.period_end) pSpent += e.amount;
                });
              });
              return acc + (pAmt - pSpent);
            }, 0);
            const sorted = [...bPeriods].sort((a, b) => a.period_start.localeCompare(b.period_start));
            const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
            const fmt = (d: string) => cap(format(parseISO(d), 'MMM', { locale: es }));
            const first = fmt(sorted[0].period_start);
            const last = fmt(sorted[sorted.length - 1].period_start);
            prevAccumMonths = first === last ? first : `${first} - ${last}`;
          }
        }
        return { ...b, category_ids: catIds, categories: bCats, spent, prevAccumulated, prevAccumMonths } as any;
      });
            setBudgets(enriched);
    } catch (err) { console.error(err); setLoading(false); }
  }

  function openForm(budget?: Budget) {
    if (budget) {
      setEditingBudget(budget); setName(budget.name); setAmount(String(budget.amount));
      setRecurrence(budget.recurrence as 'monthly' | 'yearly'); setStartDate(budget.start_date);
      setSelectedCatIds(budget.category_ids || []);
    } else {
      setEditingBudget(null); setName(''); setAmount('');
      setRecurrence('monthly');
      setStartDate(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
      setSelectedCatIds([]);
    }
    setShowForm(true);
  }

  async function handleSave() {
    if (!name || !amount) return;
    setSaving(true);
    try {
      const newAmount = parseFloat(amount);
      const budgetData = { user_id: user.id, name, amount: newAmount, recurrence, start_date: startDate };
      let budgetId: string;
      if (editingBudget) {
        await supabase.from('budgets').update(budgetData).eq('id', editingBudget.id);
        budgetId = editingBudget.id;
        await supabase.from('budget_categories').delete().eq('budget_id', budgetId);
        // Propagate new amount to current + future periods that had the old amount
        const today = format(new Date(), 'yyyy-MM-dd');
        const { data: futurePeriods } = await supabase
          .from('budget_periods').select('id, amount').eq('budget_id', budgetId).gte('period_start', today);
        if (futurePeriods && futurePeriods.length > 0) {
          const toUpdate = (futurePeriods as any[])
            .filter(p => p.amount == null || p.amount === editingBudget.amount)
            .map(p => p.id);
          if (toUpdate.length > 0)
            await supabase.from('budget_periods').update({ amount: newAmount }).in('id', toUpdate);
        }
      } else {
        const { data } = await supabase.from('budgets').insert(budgetData).select().single();
        budgetId = data.id;
      }
      if (selectedCatIds.length > 0) {
        await supabase.from('budget_categories').insert(
          selectedCatIds.map(cid => ({ budget_id: budgetId, category_id: cid }))
        );
      }
      setShowForm(false);
      loadData();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (confirm('¿Eliminar este presupuesto?')) {
      await supabase.from('budgets').delete().eq('id', id);
      loadData();
    }
  }

  function toggleLeaf(catId: string) {
    setSelectedCatIds(prev => prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]);
  }

  function toggleRoot(root: CatNode) {
    const ids = allDescendantIds(root);
    const allSelected = ids.every(id => selectedCatIds.includes(id));
    if (allSelected) {
      setSelectedCatIds(prev => prev.filter(id => !ids.includes(id)));
    } else {
      setSelectedCatIds(prev => Array.from(new Set([...prev, ...ids])));
    }
  }

  function isRootFullySelected(root: CatNode) {
    return allDescendantIds(root).every(id => selectedCatIds.includes(id));
  }
  function isRootPartiallySelected(root: CatNode) {
    const ids = allDescendantIds(root);
    return ids.some(id => selectedCatIds.includes(id)) && !ids.every(id => selectedCatIds.includes(id));
  }

  async function saveMonthlyBudget() {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val <= 0) return;
    const curMonth = format(new Date(), 'yyyy-MM');
    // Upsert from budgetStartMonth forward (propagate to future months with same amount)
    const months: string[] = [];
    let m = budgetStartMonth;
    while (m <= curMonth) {
      months.push(m);
      const d = addMonths(new Date(`${m}-01`), 1);
      m = format(d, 'yyyy-MM');
    }
    const upserts = months.map(mo => ({ user_id: user.id, month: mo, amount: val }));
    await supabase.from('global_budget_periods').upsert(upserts, { onConflict: 'user_id,month' });
    setMonthlyBudget(val);
    setShowBudgetModal(false);
  }

  const allEntries = flattenTree(roots);
  const q = searchQuery.trim().toLowerCase();
  const searchResults = q ? allEntries.filter(e => e.cat.name.toLowerCase().includes(q)) : [];

  const recurrenceLabels: Record<string, string> = { monthly: 'Mensual', yearly: 'Anual' };

  function buildSelectedLabel(): string {
    if (selectedCatIds.length === 0) return '';
    const parts: string[] = [];
    roots.forEach(r => {
      const ids = allDescendantIds(r);
      if (ids.every(id => selectedCatIds.includes(id))) {
        parts.push(`${r.icon} ${r.name} (todo)`);
      } else {
        ids.filter(id => selectedCatIds.includes(id)).forEach(id => {
          const c = categories.find(c => c.id === id);
          if (c) parts.push(`${c.icon} ${c.name}`);
        });
      }
    });
    return parts.join(', ');
  }

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto page-transition">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Presupuestos</h1>
        <button onClick={() => openForm()}
          className="bg-brand-600 hover:bg-brand-500 text-white p-2.5 rounded-xl transition-colors shadow-lg shadow-brand-600/20">
          <Plus size={18} />
        </button>
      </div>

      {/* GLOBAL BUDGET WIDGET */}
      {(() => {
        const now = new Date();
        const spent = globalStats?.spent || 0;
        const pct = monthlyBudget && monthlyBudget > 0 ? (spent / monthlyBudget) * 100 : 0;
        const left = monthlyBudget ? Math.max(monthlyBudget - spent, 0) : 0;
        const isOver = monthlyBudget ? spent > monthlyBudget : false;
        const color = isOver ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e';
        const textColor = isOver ? 'text-red-400' : pct >= 80 ? 'text-amber-400' : 'text-brand-400';
        const monthLabel = format(now, 'MMMM', { locale: es });
        const daysInMonth = endOfMonth(now).getDate();

        return (
          <button onClick={onOpenGlobalBudget} className="w-full text-left mb-4">
            <div className="rounded-2xl p-4" style={{ background: '#0a2540', border: '1px solid #1d4ed820' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-dark-500 uppercase tracking-wider capitalize">
                  Gasto global · {monthLabel}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#22c55e18', color: '#22c55e' }}>GLOBAL</span>
              </div>

              {monthlyBudget ? (
                <>
                  <div className="flex items-baseline justify-between mb-2.5">
                    <div className="flex items-baseline gap-1.5">
                      {isOver ? (
                        <><span className="text-xl font-extrabold text-red-400">{formatCurrency(spent - monthlyBudget)}</span>
                        <span className="text-xs text-red-400/70">excedido</span></>
                      ) : (
                        <><span className={`text-xl font-extrabold ${textColor}`}>{formatCurrency(left)}</span>
                        <span className="text-xs text-dark-500">disponible</span></>
                      )}
                    </div>
                    <span className="text-xs text-dark-500">de {formatCurrency(monthlyBudget)}</span>
                  </div>
                  <div className="w-full rounded-full h-1.5 mb-2 overflow-hidden relative" style={{ background: '#1e3a5f' }}>
                    {!isOver && <div className="absolute right-0 top-0 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(100 - pct, 0)}%`, backgroundColor: color }} />}
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-[10px] text-dark-500 capitalize">1 {monthLabel}</span>
                    <span className={`text-[10px] font-bold ${isOver ? 'text-red-400' : 'text-dark-400'}`}>{pct.toFixed(1)}% gastado</span>
                    <span className="text-[10px] text-dark-500 capitalize">{daysInMonth} {monthLabel}</span>
                  </div>
                  {globalAccumulated !== null && (
                    <div className="flex items-center gap-1.5 pt-2 border-t border-white/5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: globalAccumulated >= 0 ? '#22c55e' : '#ef4444' }} />
                      <span className="text-[11px] font-medium" style={{ color: globalAccumulated >= 0 ? '#22c55e' : '#ef4444' }}>
                        {formatCurrency(Math.abs(globalAccumulated))} {globalAccumulated >= 0 ? 'ahorro acumulado' : 'excedido acumulado'} en {now.getFullYear()}{globalAccumMonths ? ` (${globalAccumMonths})` : ''}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xl font-extrabold text-dark-200">{formatCurrency(spent)}</span>
                    <span className="text-xs text-dark-500 ml-2">gastado este mes</span>
                  </div>
                  <span className="text-xs text-brand-400 font-medium">Configurar →</span>
                </div>
              )}
            </div>
          </button>
        );
      })()}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : budgets.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-5xl mb-4">💰</div>
          <p className="text-dark-300 font-medium">No tenés presupuestos</p>
          <p className="text-dark-500 text-sm mt-1">Creá uno para controlar tus gastos</p>
          <button onClick={() => openForm()}
            className="mt-5 bg-brand-600/15 text-brand-400 text-sm font-semibold px-6 py-3 rounded-2xl border border-brand-600/20">
            Crear presupuesto
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((budget) => {
            const spent = budget.spent || 0;
            const left = Math.max(budget.amount - spent, 0);
            const pct = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
            const curPeriod = currentPeriods[budget.id];
            const startLabel = curPeriod ? format(parseISO(curPeriod.period_start), "MMM d", { locale: es }) : '';
            const endLabel = curPeriod ? format(parseISO(curPeriod.period_end), "MMM d, yyyy", { locale: es }) : '';

            return (
              <button key={budget.id}
                onClick={() => curPeriod && onOpenBudget(budget, curPeriod.id)}
                className="w-full bg-dark-800 rounded-2xl p-4 text-left transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-bold">{budget.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-dark-500 capitalize">
                      {budget.recurrence === 'monthly' ? 'Mensual' : 'Anual'}
                    </span>
                    <ChevronRight size={16} className="text-dark-500" />
                  </div>
                </div>
                <div className="flex items-baseline justify-between mb-2.5">
                  <div className="flex items-baseline gap-1.5">
                    {pct >= 100 ? (
                      <>
                        <span className="text-lg font-extrabold text-red-400">-{formatCurrency(Math.abs(left - budget.amount + left))}</span>
                        <span className="text-xs text-red-400/70">excedido</span>
                      </>
                    ) : (
                      <>
                        <span className={`text-lg font-extrabold ${pct >= 80 ? 'text-amber-400' : 'text-brand-400'}`}>{formatCurrency(left)}</span>
                        <span className="text-xs text-dark-500">disponible</span>
                      </>
                    )}
                  </div>
                  <span className="text-xs text-dark-500">de {formatCurrency(budget.amount)}</span>
                </div>
                <div className="w-full bg-dark-700 rounded-full h-1.5 mb-2 overflow-hidden relative">
                  {pct < 100 && (
                    <div className="absolute right-0 top-0 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(100 - pct, 0)}%`, backgroundColor: pct >= 80 ? '#f59e0b' : '#22c55e' }} />
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-dark-500 capitalize">{startLabel}</span>
                  <span className={`text-[10px] font-bold ${pct >= 100 ? 'text-red-400' : 'text-dark-400'}`}>
                    {pct.toFixed(1)}% gastado
                  </span>
                  <span className="text-[10px] text-dark-500 capitalize">{endLabel}</span>
                </div>
                {(budget as any).prevAccumulated !== null && (budget as any).prevAccumulated < 0 && (
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-red-500/10">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    <span className="text-[11px] text-red-400">{formatCurrency(Math.abs((budget as any).prevAccumulated))} excedido acumulado en {new Date().getFullYear()}{(budget as any).prevAccumMonths ? ` (${(budget as any).prevAccumMonths})` : ''}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── FORM ── */}
      {showForm && !showCatPicker && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => setShowForm(false)} className="p-1 text-dark-400 hover:text-white"><X size={24} /></button>
            <h2 className="text-base font-bold">{editingBudget ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h2>
            {editingBudget ? (
              <button onClick={() => { handleDelete(editingBudget.id); setShowForm(false); }} className="p-1 text-red-400">🗑️</button>
            ) : <div className="w-8" />}
          </div>

          <div className="px-5 py-4 flex-shrink-0 border-b border-dark-800">
            <p className="text-xs text-dark-400 font-medium mb-1 uppercase tracking-wider">{editingBudget ? 'Monto a partir de este período' : 'Monto'}</p>
            <p className="text-3xl font-extrabold text-white">{amount || '0'}</p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Nombre</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg">💰</span>
                <input type="text" placeholder="Ej: Car, Groceries..." value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 pl-11 pr-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors" />
              </div>
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Recurrencia</label>
              <div className="flex bg-dark-800 rounded-xl p-1 border border-dark-700">
                {(['monthly', 'yearly'] as const).map((r) => (
                  <button key={r} onClick={() => setRecurrence(r)}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${recurrence === r ? 'bg-brand-600 text-white shadow-lg' : 'text-dark-400'}`}>
                    {recurrenceLabels[r]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Fecha inicio</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors" />
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">
                Categorías {selectedCatIds.length > 0 && `(${selectedCatIds.length})`}
              </label>
              <button onClick={() => setShowCatPicker(true)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 px-4 text-sm text-left flex items-center justify-between">
                <span className={`flex-1 min-w-0 truncate ${selectedCatIds.length > 0 ? 'text-white' : 'text-dark-500'}`}>
                  {selectedCatIds.length > 0 ? buildSelectedLabel() : 'Seleccionar categorías...'}
                </span>
                <ChevronRight size={16} className="text-dark-500 flex-shrink-0 ml-2" />
              </button>
            </div>
          </div>

          <div className="flex-shrink-0">
            <div className="px-5 py-3">
              <button onClick={handleSave} disabled={saving || !name || !amount}
                className="w-full bg-brand-600 disabled:opacity-30 text-white font-bold py-4 rounded-2xl text-base">
                {saving ? 'Guardando...' : editingBudget ? 'Guardar cambios' : 'Crear presupuesto'}
              </button>
            </div>
            <div className="border-t border-dark-700">
              <div className="grid grid-cols-3">
                {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map((key) => {
                  const isDel = key === 'backspace';
                  return (
                    <button key={key} onClick={() => isDel ? handleNumpad('backspace') : handleNumpad(key)}
                      className="py-[14px] text-center text-xl font-medium border-b border-r border-dark-800 active:bg-dark-700 transition-colors bg-dark-900 text-white">
                      {isDel ? <span className="flex items-center justify-center"><Delete size={22} /></span> : key}
                    </button>
                  );
                })}
              </div>
              <div className="h-[env(safe-area-inset-bottom)]" />
            </div>
          </div>
        </div>
      )}

      {/* ── CATEGORY PICKER ── */}
      {showForm && showCatPicker && (
        <div className="fixed inset-0 bg-dark-900 z-[70] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => { setShowCatPicker(false); setSearchQuery(''); }} className="p-1 text-dark-400 hover:text-white">
              <ArrowLeft size={24} />
            </button>
            <h2 className="text-base font-bold">Categorías del presupuesto</h2>
            <button onClick={() => { setShowCatPicker(false); setSearchQuery(''); }} className="text-xs text-brand-400 font-medium">
              Confirmar
            </button>
          </div>

          <div className="px-4 pb-3 flex-shrink-0">
            <div className="flex items-center gap-2 bg-dark-800 rounded-2xl px-4 py-3">
              <Search size={16} className="text-dark-400 flex-shrink-0" />
              <input type="text" placeholder="Buscar categorías" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm placeholder:text-dark-500 focus:outline-none" />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="text-dark-400"><X size={14} /></button>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pb-8">
            {q ? (
              searchResults.length === 0 ? (
                <div className="text-center py-10 text-dark-500 text-sm">Sin resultados</div>
              ) : (
                <div>
                  {searchResults.map(({ cat, ancestors }) => {
                    const isSelected = selectedCatIds.includes(cat.id);
                    return (
                      <button key={cat.id} onClick={() => toggleLeaf(cat.id)}
                        className={`w-full flex items-center gap-3 px-5 py-3.5 border-b border-dark-800/60 transition-colors ${isSelected ? 'bg-dark-800' : 'active:bg-dark-800/60'}`}>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: cat.color }}>{cat.icon}</div>
                        <div className="flex-1 text-left">
                          <p className="text-sm font-medium">{cat.name}</p>
                          {ancestors.length > 0 && <p className="text-xs text-dark-400">{ancestors.map(a => a.name).join(' › ')}</p>}
                        </div>
                        {isSelected && <Check size={18} className="text-brand-400 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              roots.map(root => {
                const childEntries = flattenTree(root.children, [root]);
                const fullySelected = isRootFullySelected(root);
                const partiallySelected = isRootPartiallySelected(root);
                return (
                  <div key={root.id} className="mb-6">
                    <button onClick={() => toggleRoot(root)}
                      className="w-full flex items-center justify-between px-4 pt-4 pb-2 active:opacity-70">
                      <span className="text-xs font-bold text-dark-400 uppercase tracking-wider">{root.name}</span>
                      <div className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${
                        fullySelected ? 'bg-brand-500 border-brand-500' :
                        partiallySelected ? 'bg-brand-500/30 border-brand-500/50' : 'border-dark-600'
                      }`}>
                        {fullySelected && <Check size={12} className="text-white" />}
                        {partiallySelected && !fullySelected && <div className="w-2 h-2 rounded-sm bg-brand-400" />}
                      </div>
                    </button>
                    {childEntries.length > 0 && (
                      <div className="grid grid-cols-4 gap-x-2 gap-y-4 px-4">
                        {childEntries.map(({ cat, ancestors }) => {
                          const isSelected = selectedCatIds.includes(cat.id);
                          const depth = ancestors.length - 1;
                          const iconSize = depth === 0 ? 52 : depth === 1 ? 46 : 40;
                          return (
                            <button key={cat.id} onClick={() => toggleLeaf(cat.id)}
                              className="flex flex-col items-center gap-1.5 active:opacity-70">
                              <div className="rounded-full flex items-center justify-center flex-shrink-0 relative"
                                style={{ width: iconSize, height: iconSize, backgroundColor: cat.color, fontSize: depth === 0 ? 24 : depth === 1 ? 20 : 17,
                                  boxShadow: isSelected ? `0 0 0 3px white, 0 0 0 5px ${cat.color}` : undefined }}>
                                {cat.icon}
                                {isSelected && (
                                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-brand-500 flex items-center justify-center">
                                    <Check size={9} className="text-white" strokeWidth={3} />
                                  </div>
                                )}
                              </div>
                              <span className="text-center leading-tight text-dark-200 w-full"
                                style={{ fontSize: 11, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden', wordBreak: 'break-word' }}>
                                {cat.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
      {/* SET MONTHLY BUDGET MODAL */}
      {showBudgetModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
          <div className="bg-dark-900 w-full max-w-lg rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold">Presupuesto mensual global</h3>
              <button onClick={() => setShowBudgetModal(false)} className="text-dark-400 p-1"><X size={20} /></button>
            </div>
            <p className="text-xs text-dark-500 mb-3">¿Cuánto querés gastar como máximo por mes en total?</p>
            <div className="flex items-center gap-3 mb-3">
              <label className="text-xs text-dark-400 whitespace-nowrap">Desde</label>
              <input type="month" value={budgetStartMonth} onChange={e => setBudgetStartMonth(e.target.value)}
                max={format(new Date(), 'yyyy-MM')}
                className="flex-1 bg-dark-800 border border-dark-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-dark-500" />
            </div>
            <div className="bg-dark-800 rounded-2xl px-4 py-3 text-center mb-4">
              <span className="text-3xl font-extrabold">{budgetInput || '0'}</span>
            </div>
            <div className="grid grid-cols-3 border-t border-dark-800">
              {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map(key => (
                <button key={key}
                  onClick={() => {
                    if (key === 'backspace') setBudgetInput(p => p.slice(0, -1));
                    else if (key === '.') { if (!budgetInput.includes('.')) setBudgetInput(p => (p || '0') + '.'); }
                    else { if (budgetInput.includes('.')) { const [,d] = budgetInput.split('.'); if ((d?.length || 0) >= 2) return; } setBudgetInput(p => p + key); }
                  }}
                  className="py-4 text-center text-xl font-medium border-b border-r border-dark-800 active:bg-dark-700 bg-dark-900 text-white">
                  {key === 'backspace' ? <span className="flex items-center justify-center"><Delete size={20} /></span> : key}
                </button>
              ))}
            </div>
            <button onClick={saveMonthlyBudget}
              disabled={!budgetInput || isNaN(parseFloat(budgetInput))}
              className="w-full mt-4 bg-brand-600 disabled:opacity-30 text-white font-bold py-4 rounded-2xl text-base">
              Guardar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
