'use client';

import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Budget, Category } from '@/types';
import { ArrowLeft, ChevronLeft, ChevronRight, Edit3, Trash2, X, Delete, History } from 'lucide-react';
import { format, parseISO, differenceInDays, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import type { BudgetPeriod } from './BudgetsView';
import Amount from '@/components/ui/Amount';
import CategoryIcon from '@/components/ui/CategoryIcon';

const AddExpenseModal = lazy(() => import('@/components/AddExpenseModal'));

interface Props {
  user: User;
  budget: Budget;
  initialPeriodId: string;
  onBack: () => void;
  onRefresh: () => void;
}

interface ExpenseRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  category_id: string | null;
}

interface CatSpend {
  id: string;
  name: string;
  icon: string;
  color: string;
  spent: number;
  transactions: number;
}

interface PeriodSummary {
  period: BudgetPeriod;
  spent: number;
  isCurrent: boolean;
}

import { CatNode, buildTree, allDescendantIds } from '@/lib/categoryTree';
import { getCategories } from '@/lib/categoryCache';

function expandCatIds(catIds: string[], categories: Category[]): string[] {
  const tree = buildTree(categories);
  const allIds: string[] = [...catIds];
  const addDesc = (nodes: CatNode[]) => {
    nodes.forEach(n => {
      if (catIds.includes(n.id)) {
        allDescendantIds(n).forEach(id => { if (!allIds.includes(id)) allIds.push(id); });
      }
      addDesc(n.children);
    });
  };
  addDesc(tree);
  return allIds;
}

export default function BudgetDetailView({ user, budget, initialPeriodId, onBack, onRefresh }: Props) {
  const [periods, setPeriods] = useState<BudgetPeriod[]>([]);
  const [currentPeriodIndex, setCurrentPeriodIndex] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allCatIds, setAllCatIds] = useState<string[]>([]);

  const periodCache = useRef<Map<string, { expenses: ExpenseRow[]; total: number; catSpending: CatSpend[] }>>(new Map());

  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [catSpending, setCatSpending] = useState<CatSpend[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [historySummaries, setHistorySummaries] = useState<PeriodSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyYear, setHistoryYear] = useState<number>(new Date().getFullYear());

  // Edit form
  const [showEditForm, setShowEditForm] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [saving, setSaving] = useState(false);

  // Expense editing
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  const swipeStartX = useRef<number | null>(null);
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const yestStr = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');

  useEffect(() => { init(); }, [budget.id, user.id]);

  useEffect(() => {
    if (periods.length > 0 && allCatIds.length > 0) {
      loadPeriodData(currentPeriodIndex);
    }
  }, [currentPeriodIndex, periods, allCatIds]);

  async function init() {
    setLoading(true);
    setError(null);
    periodCache.current.clear();
    try {
      const [{ data: periodsData }, catsMap, { data: bcData }] = await Promise.all([
        supabase.from('budget_periods').select('*').eq('budget_id', budget.id).order('period_start', { ascending: false }),
        getCategories(user.id),
        supabase.from('budget_categories').select('category_id').eq('budget_id', budget.id),
      ]);
      const allPeriods = periodsData || [];
      const allCats = Array.from(catsMap.values());
      const catIds = (bcData || []).map((bc: any) => bc.category_id);
      const expanded = expandCatIds(catIds, allCats);
      setPeriods(allPeriods);
      setCategories(allCats);
      setAllCatIds(expanded);
      const idx = allPeriods.findIndex((p: BudgetPeriod) => p.id === initialPeriodId);
      setCurrentPeriodIndex(idx >= 0 ? idx : 0);
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los datos');
    } finally {
      setLoading(false);
    }
  }

  async function loadPeriodData(index: number) {
    if (periods.length === 0 || allCatIds.length === 0) return;
    const period = periods[index];

    const cached = periodCache.current.get(period.id);
    if (cached) {
      setExpenses(cached.expenses);
      setTotalSpent(cached.total);
      setCatSpending(cached.catSpending);
      setEditAmount(String(period.amount ?? budget.amount));
      return;
    }

    setLoading(true);
    try {
      const { data: expData } = await supabase
        .from('expenses')
        .select('id, amount, description, date, category_id')
        .eq('user_id', user.id)
        .in('category_id', allCatIds)
        .gte('date', period.period_start)
        .lte('date', period.period_end)
        .order('date', { ascending: false });

      const exps = (expData || []).map((e: any) => ({
        id: e.id, date: e.date, description: e.description,
        amount: Number(e.amount), category_id: e.category_id,
      }));
      const total = exps.reduce((s, e) => s + e.amount, 0);
      const spendByCat: Record<string, number> = {};
      const txByCat: Record<string, number> = {};
      exps.forEach(e => {
        if (e.category_id) {
          spendByCat[e.category_id] = (spendByCat[e.category_id] || 0) + e.amount;
          txByCat[e.category_id] = (txByCat[e.category_id] || 0) + 1;
        }
      });
      const catSpends: CatSpend[] = categories
        .filter(c => allCatIds.includes(c.id) && (spendByCat[c.id] || 0) > 0)
        .map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, spent: spendByCat[c.id] || 0, transactions: txByCat[c.id] || 0 }))
        .sort((a, b) => b.spent - a.spent);

      periodCache.current.set(period.id, { expenses: exps, total, catSpending: catSpends });
      setExpenses(exps);
      setTotalSpent(total);
      setCatSpending(catSpends);
      setEditAmount(String(period.amount ?? budget.amount));
    } catch (err) {
      console.error(err);
      setError('Error al cargar gastos');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistorySummaries(year: number) {
    if (allCatIds.length === 0 || periods.length === 0) return;
    setHistoryLoading(true);
    try {
      const yearPeriods = periods.filter(p => parseISO(p.period_start).getFullYear() === year);
      if (yearPeriods.length === 0) {
        setHistorySummaries([]);
        setHistoryLoading(false);
        return;
      }

      const oldest = yearPeriods[yearPeriods.length - 1]?.period_start;
      const newest = yearPeriods[0]?.period_end;

      const { data: allExp } = await supabase
        .from('expenses')
        .select('amount, date')
        .eq('user_id', user.id)
        .in('category_id', allCatIds)
        .gte('date', oldest)
        .lte('date', newest);

      const expList = (allExp || []).map((e: any) => ({ amount: Number(e.amount), date: e.date as string }));

      const summaries: PeriodSummary[] = periods.map(p => {
        const pYear = parseISO(p.period_start).getFullYear();
        const spent = pYear === year
          ? expList.filter(e => e.date >= p.period_start && e.date <= p.period_end).reduce((s, e) => s + e.amount, 0)
          : 0;
        const isCurrent = todayStr >= p.period_start && todayStr <= p.period_end;
        return { period: p, spent, isCurrent };
      });

      setHistorySummaries(summaries);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  }

  function openHistory() {
    setShowHistory(true);
    loadHistorySummaries(historyYear);
  }

  function changeHistoryYear(newYear: number) {
    setHistoryYear(newYear);
    loadHistorySummaries(newYear);
  }

  function navigatePeriod(dir: 1 | -1) {
    const next = currentPeriodIndex + dir;
    if (next >= 0 && next < periods.length) setCurrentPeriodIndex(next);
  }

  function onTouchStart(e: React.TouchEvent) { swipeStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null) return;
    const dx = swipeStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 50) navigatePeriod(dx > 0 ? 1 : -1);
    swipeStartX.current = null;
  }

  function handleNumpad(key: string) {
    if (key === 'backspace') { setEditAmount(prev => prev.slice(0, -1)); }
    else if (key === '.') { if (!editAmount.includes('.')) setEditAmount(prev => (prev || '0') + '.'); }
    else {
      if (editAmount.includes('.')) { const [, d] = editAmount.split('.'); if (d?.length >= 2) return; }
      setEditAmount(prev => prev + key);
    }
  }

  async function handleSaveAmount() {
    if (!editAmount || isNaN(parseFloat(editAmount))) return;
    setSaving(true);
    try {
      const newAmount = parseFloat(editAmount);
      const currentPeriod = periods[currentPeriodIndex];
      const oldAmount = currentPeriod.amount ?? budget.amount;

      const { error } = await supabase.from('budget_periods').update({ amount: newAmount }).eq('id', currentPeriod.id);
      if (error) throw error;

      const futurePeriods = periods.filter((p, i) =>
        i < currentPeriodIndex &&
        p.period_start > currentPeriod.period_start &&
        (p.amount == null || p.amount === oldAmount)
      );
      if (futurePeriods.length > 0) {
        await supabase.from('budget_periods')
          .update({ amount: newAmount })
          .in('id', futurePeriods.map(p => p.id));
      }

      setPeriods(prev => prev.map((p, i) => {
        if (i === currentPeriodIndex) return { ...p, amount: newAmount };
        if (futurePeriods.some(fp => fp.id === p.id)) return { ...p, amount: newAmount };
        return p;
      }));
      futurePeriods.forEach(p => periodCache.current.delete(p.id));
      periodCache.current.delete(currentPeriod.id);
      setShowEditForm(false);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('¿Eliminar este presupuesto? Esta acción no se puede deshacer.')) return;
    try {
      const { error } = await supabase.from('budgets').delete().eq('id', budget.id);
      if (error) throw error;
      onBack();
    } catch (err) { console.error(err); }
  }

  function openExpenseEdit(exp: ExpenseRow) {
    setEditingExpense({
      id: exp.id, amount: Number(exp.amount), description: exp.description,
      category_id: exp.category_id, date: exp.date,
    });
    setShowExpenseModal(true);
  }

  const period = periods[currentPeriodIndex];

  const periodDerived = useMemo(() => {
    if (!period) return null;
    const periodAmount = period.amount ?? budget.amount;
    const periodStart = parseISO(period.period_start);
    const periodEnd = parseISO(period.period_end);
    const isCurrentPeriod = isWithinInterval(now, { start: periodStart, end: periodEnd });
    const pct = periodAmount > 0 ? (totalSpent / periodAmount) * 100 : 0;
    const budgetColor = pct >= 100 ? '#ef4444' : (isCurrentPeriod && pct >= 80) ? '#f59e0b' : '#22c55e';
    const budgetTextColor = pct >= 100 ? 'text-red-400' : (isCurrentPeriod && pct >= 80) ? 'text-amber-400' : 'text-brand-400';
    const left = Math.max(periodAmount - totalSpent, 0);
    const totalDays = differenceInDays(periodEnd, periodStart) + 1;
    const daysLeft = Math.max(differenceInDays(periodEnd, now), 0);
    const perDay = daysLeft > 0 ? left / daysLeft : 0;
    const periodLabel = format(periodStart, budget.recurrence === 'monthly' ? 'MMMM yyyy' : 'yyyy', { locale: es });

    return { periodAmount, periodStart, periodEnd, isCurrentPeriod, pct, budgetColor, budgetTextColor, left, totalDays, daysLeft, perDay, periodLabel };
  }, [period, totalSpent, budget.amount, budget.recurrence]);

  const grouped = useMemo(() => {
    const dayMap = new Map<string, ExpenseRow[]>();
    expenses.forEach(e => { if (!dayMap.has(e.date)) dayMap.set(e.date, []); dayMap.get(e.date)!.push(e); });
    return Array.from(dayMap.entries())
      .map(([dateStr, exps]) => ({
        date: dateStr,
        label: dateStr === todayStr ? 'Hoy' : dateStr === yestStr ? 'Ayer' : format(parseISO(dateStr), "d 'de' MMMM", { locale: es }),
        total: exps.reduce((s, e) => s + e.amount, 0),
        expenses: exps,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, todayStr, yestStr]);

  const { historyByYear, historyYears } = useMemo(() => {
    const byYear: Record<number, { summary: PeriodSummary; originalIndex: number }[]> = {};
    historySummaries.forEach((s, i) => {
      const y = parseISO(s.period.period_start).getFullYear();
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push({ summary: s, originalIndex: i });
    });
    const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
    return { historyByYear: byYear, historyYears: years };
  }, [historySummaries]);

  const { historyYearData, historyAccumulated, histAccumMonths } = useMemo(() => {
    const yearData = historyByYear[historyYear] || [];
    const closedItems = yearData.filter(({ summary: s }) => !s.isCurrent);
    const accumulated = closedItems.reduce((sum, { summary: s }) => sum + ((s.period.amount ?? budget.amount) - s.spent), 0);
    let accumMonths = '';
    if (closedItems.length > 0) {
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const sorted = [...closedItems].sort((a, b) => a.summary.period.period_start.localeCompare(b.summary.period.period_start));
      const fmt = (d: string) => cap(format(parseISO(d), 'MMM', { locale: es }));
      const first = fmt(sorted[0].summary.period.period_start);
      const last = fmt(sorted[sorted.length - 1].summary.period.period_start);
      accumMonths = first === last ? first : `${first} - ${last}`;
    }
    return { historyYearData: yearData, historyAccumulated: accumulated, histAccumMonths: accumMonths };
  }, [historyByYear, historyYear, budget.amount]);

  // ── Stacked bar for categories ─────────────────────────────────────────────
  const catStackedBar = useMemo(() => {
    if (!periodDerived || catSpending.length === 0) return null;
    const { periodAmount } = periodDerived;
    const total = catSpending.reduce((s, c) => s + c.spent, 0);
    return catSpending.map(c => ({
      ...c,
      pct: total > 0 ? (c.spent / total) * 100 : 0,
      pctOfBudget: periodAmount > 0 ? (c.spent / periodAmount) * 100 : 0,
    }));
  }, [catSpending, periodDerived]);

  if (periods.length === 0 && !loading) return <div className="text-center py-10 text-dark-400">No hay períodos disponibles</div>;
  if (!period || !periodDerived) return null;

  const { periodAmount, periodStart, periodEnd, isCurrentPeriod, pct, budgetColor, budgetTextColor, left, daysLeft, perDay, periodLabel } = periodDerived;
  const hasPrev = currentPeriodIndex < periods.length - 1;
  const hasNext = currentPeriodIndex > 0;

  return (
    <div className="max-w-lg mx-auto pb-8 page-transition" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>

      {/* HEADER */}
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <button onClick={onBack} className="p-1 text-dark-300"><ArrowLeft size={20} /></button>
        <div className="flex items-center gap-1">
          <button onClick={() => { setEditAmount(String(periodAmount)); setShowEditForm(true); }} className="p-1.5 text-dark-400 hover:text-white"><Edit3 size={16} /></button>
          <button onClick={handleDelete} className="p-1.5 text-dark-400 hover:text-red-400"><Trash2 size={16} /></button>
        </div>
      </div>

      {/* PERIOD NAVIGATOR */}
      <div className="text-center mb-1 px-4">
        <h1 className="text-base font-bold truncate">{budget.name}</h1>
      </div>
      <div className="flex items-center justify-between px-4 mb-2">
        <button onClick={() => navigatePeriod(1)} disabled={!hasPrev}
          className={`p-1.5 rounded-full transition-colors ${hasPrev ? 'text-dark-300 active:bg-dark-800' : 'text-dark-700 cursor-not-allowed'}`}>
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <p className="text-base font-bold capitalize">{periodLabel}</p>
        </div>
        <button onClick={() => navigatePeriod(-1)} disabled={!hasNext}
          className={`p-1.5 rounded-full transition-colors ${hasNext ? 'text-dark-300 active:bg-dark-800' : 'text-dark-700 cursor-not-allowed'}`}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* BUDGET HISTORY BUTTON — pill style like Spending Overview */}
      <div className="flex justify-center pb-3 border-b border-dark-800/60">
        <button
          onClick={openHistory}
          className="inline-flex items-center gap-2 bg-dark-800 rounded-full px-4 py-2 active:bg-dark-700 transition-colors"
        >
          <History size={14} className="text-brand-400" />
          <span className="text-[13px] font-semibold text-dark-100">Budget History</span>
          <ChevronRight size={13} className="text-dark-500" />
        </button>
      </div>

      {error ? (
        <div className="text-center py-10 text-red-400 px-4">{error}</div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* HERO AMOUNT */}
          <div className="px-4 pt-5 pb-1 text-center">
            {pct >= 100 ? (
              <>
                <Amount value={totalSpent - periodAmount} size="xl" color="text-red-400" weight="extrabold" decimals={false} />
                <p className="text-red-400/70 text-[13px] mt-1">excedido</p>
              </>
            ) : (
              <>
                <Amount value={left} size="xl" color={budgetTextColor} weight="extrabold" decimals={false} />
                <p className={`text-[13px] font-semibold mt-1 ${budgetTextColor}`} style={{ opacity: 0.75 }}>
                  {isCurrentPeriod ? 'disponible' : 'sin usar'}
                </p>
              </>
            )}
          </div>

          {/* ADVICE */}
          {isCurrentPeriod && (
            <div className="mx-4 mb-3 bg-brand-500/8 border border-brand-500/15 rounded-2xl px-4 py-3">
              <p className="text-sm text-dark-200 text-center">
                {pct >= 100 ? '¡Ya superaste el presupuesto!'
                  : daysLeft > 0
                    ? budget.recurrence === 'yearly'
                      ? (() => {
                          const monthsLeft = Math.round(daysLeft / 30.4 * 10) / 10;
                          const perMonth = monthsLeft > 0 ? left / monthsLeft : 0;
                          return <>Podés gastar <Amount value={perMonth} size="sm" color={budgetTextColor} weight="bold" decimals={false} />/mes durante {monthsLeft} meses más.</>
                        })()
                      : <>Podés gastar <Amount value={perDay} size="sm" color={budgetTextColor} weight="bold" decimals={false} />/día durante {daysLeft} días más.</>
                    : 'Último día del período.'}
              </p>
            </div>
          )}

          {/* PROGRESS BAR — green from right = available */}
          <div className="px-4 mb-0">
            <div className="w-full bg-dark-700 rounded-full h-2.5 overflow-hidden relative">
              <div
                className="absolute right-0 top-0 h-full rounded-full transition-all duration-500"
                style={{ width: `${pct >= 100 ? 0 : Math.max(100 - pct, 0)}%`, backgroundColor: budgetColor }}
              />
            </div>
          </div>

          {/* STATS ROW — replaces old "TOTAL GASTADO" */}
          <div className="flex items-stretch border-t border-b border-dark-800/60 mt-4">
            <div className="flex-1 px-4 py-3 text-center border-r border-dark-800/60">
              <p className="text-[9px] font-semibold text-dark-500 uppercase tracking-wider mb-0.5">Gastado</p>
              <p className="text-[15px] font-bold text-red-400">
                {formatCurrency(totalSpent, undefined, true)}
                <span className="text-[11px] font-normal text-dark-500 ml-1">/ {formatCurrency(periodAmount, undefined, true)}</span>
              </p>
            </div>
            <div className="flex-1 px-4 py-3 text-center">
              <p className="text-[9px] font-semibold text-dark-500 uppercase tracking-wider mb-0.5">% gastado</p>
              <p className="text-[15px] font-bold text-dark-100">{pct.toFixed(1)}%</p>
            </div>
          </div>

          {/* CATEGORY BREAKDOWN — stacked bar + dot list */}
          {catSpending.length > 0 && catStackedBar && (
            <div className="mt-1">
              <p className="px-4 pt-3 pb-2 text-[10px] font-semibold text-dark-500 uppercase tracking-wider">Por categoría</p>

              {/* Stacked bar */}
              <div className="mx-4 mb-2 h-2.5 rounded-full overflow-hidden flex gap-px">
                {catStackedBar.map(cat => (
                  <div key={cat.id} style={{ width: `${cat.pct}%`, background: cat.color }} />
                ))}
              </div>

              {/* Category rows */}
              {catStackedBar.map(cat => (
                <div key={cat.id} className="flex items-center gap-3 px-4 py-2 border-b border-dark-800/40">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                  <span className="flex-1 text-[12px] text-dark-200 font-medium">{cat.name}</span>
                  <span className="text-[11px] text-dark-500 mr-1">{Math.round(cat.pct)}%</span>
                  <Amount value={cat.spent} size="sm" color="text-dark-100" weight="bold" className="text-[12px]" decimals={false} />
                </div>
              ))}
            </div>
          )}

          {/* TRANSACTIONS */}
          {grouped.length === 0 ? (
            <div className="text-center py-10"><p className="text-dark-500 text-sm">Sin gastos en este período</p></div>
          ) : (
            <div>
              <p className="px-4 pt-3 pb-1 text-sm font-bold">Transacciones</p>
              {grouped.map(group => (
                <div key={group.date}>
                  <div className="flex items-center justify-between px-4 py-1.5 bg-dark-800/60">
                    <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wider capitalize">{group.label}</span>
                    <Amount value={group.total} sign="-" size="sm" weight="semibold" color="text-dark-500" className="text-[10px]" decimals={false} />
                  </div>
                  {group.expenses.map(exp => {
                    const cat = categories.find(c => c.id === exp.category_id);
                    return (
                      <div key={exp.id} onClick={() => openExpenseEdit(exp)} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-dark-800/40 active:bg-dark-700/40 cursor-pointer transition-colors">
                        <CategoryIcon icon={cat?.icon || 'hand-coins'} color={cat?.color || '#475569'} size={32} rounded="xl" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold truncate">{cat?.name || 'Sin categoría'}</p>
                          {exp.description && exp.description !== cat?.name && (
                            <p className="text-[10px] text-dark-500 truncate">{exp.description}</p>
                          )}
                        </div>
                        <Amount value={exp.amount} sign="-" size="sm" color="text-red-400" weight="bold" className="flex-shrink-0" decimals={false} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* HISTORY SCREEN */}
      {showHistory && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0 border-b border-dark-800">
            <button onClick={() => setShowHistory(false)} className="p-1 text-dark-400"><ArrowLeft size={22} /></button>
            <h2 className="text-base font-bold">Historial · {budget.name}</h2>
            <div className="w-8" />
          </div>
          <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
            <button
              onClick={() => { const i = historyYears.indexOf(historyYear); if (i < historyYears.length - 1) changeHistoryYear(historyYears[i + 1]); }}
              disabled={historyYears.indexOf(historyYear) >= historyYears.length - 1}
              className="p-2 rounded-xl bg-dark-800 text-dark-300 disabled:opacity-30 active:bg-dark-700">
              <ChevronLeft size={18} />
            </button>
            <div className="text-center">
              <p className="text-base font-bold">{historyYear}</p>
              {historyYearData.some(({ summary: s }) => !s.isCurrent) && (
                <p className={`text-[11px] font-medium mt-0.5 ${historyAccumulated >= 0 ? 'text-brand-400' : 'text-red-400'}`}>
                  {formatCurrency(Math.abs(historyAccumulated), undefined, true)} {historyAccumulated >= 0 ? 'ahorro acumulado' : 'excedido acumulado'} en {historyYear}{histAccumMonths ? ` (${histAccumMonths})` : ''}
                </p>
              )}
            </div>
            <button
              onClick={() => { const i = historyYears.indexOf(historyYear); if (i > 0) changeHistoryYear(historyYears[i - 1]); }}
              disabled={historyYears.indexOf(historyYear) <= 0}
              className="p-2 rounded-xl bg-dark-800 text-dark-300 disabled:opacity-30 active:bg-dark-700">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="h-px bg-dark-800 mx-4 mb-1 flex-shrink-0" />
          <div className="flex-1 overflow-y-auto pb-8">
            {historyLoading ? (
              <div className="flex justify-center py-16">
                <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
              </div>
            ) : historyYearData.length === 0 ? (
              <div className="text-center py-16 text-dark-500">Sin datos para {historyYear}</div>
            ) : (
              <div className="px-4 py-2 flex flex-col gap-1">
                {historyYearData.map(({ summary: s, originalIndex }) => {
                  const pAmt = s.period.amount ?? budget.amount;
                  const sPct = pAmt > 0 ? (s.spent / pAmt) * 100 : 0;
                  const sLeft = Math.max(pAmt - s.spent, 0);
                  const pStart = parseISO(s.period.period_start);
                  const label = format(pStart, budget.recurrence === 'monthly' ? 'MMMM' : 'yyyy', { locale: es });
                  const isOver = s.spent > pAmt;
                  const dotColor = isOver ? '#ef4444' : (s.isCurrent && sPct >= 80) ? '#f59e0b' : '#22c55e';
                  const availPct = Math.max(100 - sPct, 0);
                  return (
                    <button key={s.period.id}
                      onClick={() => { setCurrentPeriodIndex(originalIndex); setHistoryYear(new Date().getFullYear()); setShowHistory(false); }}
                      className={`w-full text-left px-4 py-3 rounded-2xl active:bg-dark-800/60 transition-colors ${s.isCurrent ? 'bg-dark-800/60' : ''}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-sm font-bold capitalize ${s.isCurrent ? 'text-white' : 'text-dark-200'}`}>{label}</span>
                            {s.isCurrent && <span className="text-[9px] font-bold bg-brand-500/20 text-brand-400 px-1.5 py-0.5 rounded-full">actual</span>}
                          </div>
                          <span className="text-[11px] text-dark-500">
                            {formatCurrency(s.spent, undefined, true)} / {formatCurrency(pAmt, undefined, true)} · {sPct.toFixed(0)}% gastado
                          </span>
                        </div>
                        <div className="text-right">
                          <p className="text-[15px] font-bold" style={{ color: dotColor }}>
                            {isOver ? formatCurrency(s.spent - pAmt, undefined, true) : formatCurrency(sLeft, undefined, true)}
                          </p>
                          <p className="text-[10px] font-medium" style={{ color: dotColor, opacity: 0.7 }}>
                            {isOver ? 'excedido' : s.isCurrent ? 'disponible' : 'sin usar'}
                          </p>
                        </div>
                      </div>
                      <div className="w-full bg-dark-700 rounded-full h-1.5 overflow-hidden relative">
                        {!isOver && (
                          <div className="absolute right-0 top-0 h-full rounded-full"
                            style={{ width: `${availPct}%`, backgroundColor: dotColor }} />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDIT AMOUNT FORM */}
      {showEditForm && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => setShowEditForm(false)} className="p-1 text-dark-400"><X size={24} /></button>
            <h2 className="text-base font-bold">Editar monto</h2>
            <div className="w-8" />
          </div>
          <div className="px-5 py-6 flex-shrink-0 border-b border-dark-800 text-center">
            <p className="text-xs text-dark-400 mb-1">Monto para {format(parseISO(period.period_start), 'MMMM yyyy', { locale: es })}</p>
            <p className="text-4xl font-extrabold">{editAmount || '0'}</p>
          </div>
          <div className="flex-1" />
          <div className="flex-shrink-0">
            <div className="px-5 py-3">
              <button onClick={handleSaveAmount} disabled={saving || !editAmount || isNaN(parseFloat(editAmount))}
                className="w-full bg-brand-600 disabled:opacity-30 text-white font-bold py-4 rounded-2xl text-base">
                {saving ? 'Guardando...' : 'Guardar para este período'}
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

      {showExpenseModal && (
        <Suspense fallback={null}>
          <AddExpenseModal
            user={user}
            defaultCurrency={budget.currency as any}
            onClose={() => { setShowExpenseModal(false); setEditingExpense(null); }}
            onSaved={() => {
              periodCache.current.clear();
              loadPeriodData(currentPeriodIndex);
              onRefresh();
            }}
            editingExpense={editingExpense}
          />
        </Suspense>
      )}
    </div>
  );
}
