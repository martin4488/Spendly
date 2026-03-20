'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Budget, Category } from '@/types';
import { ArrowLeft, ChevronLeft, ChevronRight, Edit3, Trash2, X, Delete, History, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { format, parseISO, differenceInDays, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import type { BudgetPeriod } from './BudgetsView';

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

interface CatNode extends Category { children: CatNode[] }

function buildTree(flat: Category[]): CatNode[] {
  const map = new Map<string, CatNode>();
  flat.forEach(c => map.set(c.id, { ...c, children: [] }));
  const roots: CatNode[] = [];
  flat.forEach(c => {
    if (c.parent_id && map.has(c.parent_id)) map.get(c.parent_id)!.children.push(map.get(c.id)!);
    else if (!c.parent_id) roots.push(map.get(c.id)!);
  });
  return roots;
}

function allDescendantIds(node: CatNode): string[] {
  return [node.id, ...node.children.flatMap(allDescendantIds)];
}

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

  // Per-period cache: periodId -> data
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

  const swipeStartX = useRef<number | null>(null);
  const now = new Date();

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
      const [{ data: periodsData }, { data: catsData }, { data: bcData }] = await Promise.all([
        supabase.from('budget_periods').select('*').eq('budget_id', budget.id).order('period_start', { ascending: false }),
        supabase.from('categories').select('*').eq('user_id', user.id).neq('deleted', true),
        supabase.from('budget_categories').select('category_id').eq('budget_id', budget.id),
      ]);
      const allPeriods = periodsData || [];
      const allCats = catsData || [];
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

    // Serve from cache if available
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

  async function loadHistorySummaries() {
    if (allCatIds.length === 0 || periods.length === 0) return;
    setHistoryLoading(true);
    try {
      const oldest = periods[periods.length - 1]?.period_start;
      const newest = periods[0]?.period_end;
      // Single query for ALL expenses across all periods
      const { data: allExp } = await supabase
        .from('expenses')
        .select('amount, date')
        .eq('user_id', user.id)
        .in('category_id', allCatIds)
        .gte('date', oldest)
        .lte('date', newest);

      const expList = (allExp || []).map((e: any) => ({ amount: Number(e.amount), date: e.date as string }));
      const todayStr = format(now, 'yyyy-MM-dd');

      const summaries: PeriodSummary[] = periods.map(p => {
        const spent = expList
          .filter(e => e.date >= p.period_start && e.date <= p.period_end)
          .reduce((s, e) => s + e.amount, 0);
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
    loadHistorySummaries();
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
      const { error } = await supabase.from('budget_periods').update({ amount: newAmount }).eq('id', currentPeriod.id);
      if (error) throw error;
      setPeriods(prev => prev.map((p, i) => i === currentPeriodIndex ? { ...p, amount: newAmount } : p));
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

  if (periods.length === 0 && !loading) return <div className="text-center py-10 text-dark-400">No hay períodos disponibles</div>;
  const period = periods[currentPeriodIndex];
  if (!period) return null;

  const periodAmount = period.amount ?? budget.amount;
  const periodStart = parseISO(period.period_start);
  const periodEnd = parseISO(period.period_end);
  const isCurrentPeriod = isWithinInterval(now, { start: periodStart, end: periodEnd });
  const hasPrev = currentPeriodIndex < periods.length - 1;
  const hasNext = currentPeriodIndex > 0;
  const pct = periodAmount > 0 ? (totalSpent / periodAmount) * 100 : 0;
  const budgetColor = pct >= 100 ? '#ef4444' : (isCurrentPeriod && pct >= 80) ? '#f59e0b' : '#22c55e';
  const budgetTextColor = pct >= 100 ? 'text-red-400' : (isCurrentPeriod && pct >= 80) ? 'text-amber-400' : 'text-brand-400';
  const historyByYear: Record<number, { summary: PeriodSummary; originalIndex: number }[]> = {};
  historySummaries.forEach((s, i) => {
    const y = parseISO(s.period.period_start).getFullYear();
    if (!historyByYear[y]) historyByYear[y] = [];
    historyByYear[y].push({ summary: s, originalIndex: i });
  });
  const historyYears = Object.keys(historyByYear).map(Number).sort((a, b) => b - a);
  const historyYearData = historyByYear[historyYear] || [];
  const historyAccumulated = historyYearData
    .filter(({ summary: s }) => !s.isCurrent)
    .reduce((sum, { summary: s }) => sum + ((s.period.amount ?? budget.amount) - s.spent), 0);
  const left = Math.max(periodAmount - totalSpent, 0);
  const totalDays = differenceInDays(periodEnd, periodStart) + 1;
  const daysPassed = isCurrentPeriod ? Math.min(differenceInDays(now, periodStart) + 1, totalDays) : totalDays;
  const daysLeft = Math.max(differenceInDays(periodEnd, now), 0);
  const perDay = daysLeft > 0 ? left / daysLeft : 0;
  const timeProgress = (daysPassed / totalDays) * 100;
  const periodLabel = format(periodStart, budget.recurrence === 'monthly' ? 'MMMM yyyy' : 'yyyy', { locale: es });
  const todayStr = format(now, 'yyyy-MM-dd');
  const yestStr = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');
  const dayMap = new Map<string, ExpenseRow[]>();
  expenses.forEach(e => { if (!dayMap.has(e.date)) dayMap.set(e.date, []); dayMap.get(e.date)!.push(e); });
  const grouped = Array.from(dayMap.entries())
    .map(([dateStr, exps]) => ({
      date: dateStr,
      label: dateStr === todayStr ? 'Hoy' : dateStr === yestStr ? 'Ayer' : format(parseISO(dateStr), "d 'de' MMMM", { locale: es }),
      total: exps.reduce((s, e) => s + e.amount, 0),
      expenses: exps,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

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

      {/* PERIOD NAVIGATOR — title centered above date */}
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

      {/* BUDGET HISTORY BUTTON */}
      <div className="px-3 pb-2">
        <button onClick={openHistory}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-dark-400 hover:text-dark-200 transition-colors">
          <History size={13} className="text-brand-400" />
          <span className="text-[11px] font-medium">Budget History</span>
          <ChevronRight size={12} className="text-dark-500" />
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
          {/* AMOUNT */}
          <div className="px-4 mb-4 text-center">
            {pct >= 100 ? (
              <>
                <p className="text-4xl font-extrabold text-red-400">{formatCurrency(totalSpent - periodAmount)}</p>
                <p className="text-red-400/70 text-sm mt-0.5">excedido de {formatCurrency(periodAmount)}</p>
              </>
            ) : (
              <>
                <p className={`text-4xl font-extrabold ${budgetTextColor}`}>{formatCurrency(left)}</p>
                <p className="text-dark-500 text-sm mt-0.5">disponible de {formatCurrency(periodAmount)}</p>
              </>
            )}
          </div>

          {/* ADVICE */}
          {isCurrentPeriod && (
            <div className="mx-4 mb-4 bg-brand-500/8 border border-brand-500/15 rounded-2xl px-4 py-3">
              <p className="text-sm text-dark-200 text-center">
                {pct >= 100 ? '¡Ya superaste el presupuesto!'
                  : daysLeft > 0
                    ? budget.recurrence === 'yearly'
                      ? (() => {
                          const monthsLeft = Math.round(daysLeft / 30.4 * 10) / 10;
                          const perMonth = monthsLeft > 0 ? left / monthsLeft : 0;
                          return <>Podés gastar <span className={`font-bold ${budgetTextColor}`}>{formatCurrency(perMonth)}</span>/mes durante {monthsLeft} meses más.</>
                        })()
                      : <>Podés gastar <span className={`font-bold ${budgetTextColor}`}>{formatCurrency(perDay)}</span>/día durante {daysLeft} días más.</>
                    : 'Último día del período.'}
              </p>
            </div>
          )}

          {/* PROGRESS BAR */}
          <div className="px-4 mb-5">
            <div className="w-full bg-dark-700 rounded-full h-2.5 overflow-hidden relative">
              <div className="absolute right-0 top-0 h-full rounded-full transition-all duration-500"
                style={{ width: `${pct >= 100 ? 0 : Math.max(100 - pct, 0)}%`, backgroundColor: budgetColor }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-dark-500">{format(periodStart, 'MMM d', { locale: es })}</span>
              <span className={`text-[10px] font-bold ${pct >= 100 ? 'text-red-400' : 'text-dark-400'}`}>{pct.toFixed(1)}% gastado</span>
              <span className="text-[10px] text-dark-500">{format(periodEnd, 'MMM d', { locale: es })}</span>
            </div>
          </div>

          {/* PERIOD DOTS — oldest left, newest right; all round; active = budget color */}
          {periods.length > 1 && (
            <div className="flex justify-center gap-1.5 mb-5">
              {periods.length > 12 && <span className="text-[10px] text-dark-600">+{periods.length - 12}</span>}
              {periods.slice(0, Math.min(periods.length, 12)).map((_, i) => {
                const visibleCount = Math.min(periods.length, 12);
                const reversedI = visibleCount - 1 - i;
                const isActive = reversedI === currentPeriodIndex;
                const activeColor = budgetColor;
                return (
                  <button key={i} onClick={() => setCurrentPeriodIndex(reversedI)}
                    className="w-2 h-2 rounded-full transition-all flex-shrink-0"
                    style={{ backgroundColor: isActive ? activeColor : '#334155' }} />
                );
              })}
            </div>
          )}

          {/* CATEGORY BREAKDOWN */}
          {catSpending.length > 0 && (
            <div className="px-4 mb-5">
              <p className="text-xs text-dark-500 font-medium uppercase tracking-wider mb-3">Por categoría</p>
              <div className="space-y-2">
                {catSpending.map(cat => {
                  const catPct = periodAmount > 0 ? (cat.spent / periodAmount) * 100 : 0;
                  return (
                    <div key={cat.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: cat.color }}>{cat.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between mb-0.5">
                          <span className="text-xs font-medium truncate">{cat.name}</span>
                          <span className="text-xs text-dark-400 flex-shrink-0 ml-2">{formatCurrency(cat.spent)}</span>
                        </div>
                        <div className="w-full bg-dark-700 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full" style={{ width: `${catPct}%`, backgroundColor: cat.color }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TOTAL */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-b border-dark-800/60 mb-1">
            <span className="text-xs text-dark-400 font-medium uppercase tracking-wider">Total gastado</span>
            <span className="text-base font-bold text-red-400">-{formatCurrency(totalSpent)}</span>
          </div>

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
                    <span className="text-[10px] font-semibold text-dark-500">-{formatCurrency(group.total)}</span>
                  </div>
                  {group.expenses.map(exp => {
                    const cat = categories.find(c => c.id === exp.category_id);
                    return (
                      <div key={exp.id} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-dark-800/40">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: cat?.color || '#475569' }}>
                          {cat?.icon || '💸'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold truncate">{cat?.name || 'Sin categoría'}</p>
                          {exp.description && exp.description !== cat?.name && (
                            <p className="text-[10px] text-dark-500 truncate">{exp.description}</p>
                          )}
                        </div>
                        <span className="text-[12px] font-bold text-red-400 flex-shrink-0">-{formatCurrency(exp.amount)}</span>
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
              onClick={() => { const i = historyYears.indexOf(historyYear); if (i < historyYears.length - 1) setHistoryYear(historyYears[i + 1]); }}
              disabled={historyYears.indexOf(historyYear) >= historyYears.length - 1}
              className="p-2 rounded-xl bg-dark-800 text-dark-300 disabled:opacity-30 active:bg-dark-700">
              <ChevronLeft size={18} />
            </button>
            <div className="text-center">
              <p className="text-base font-bold">{historyYear}</p>
              {historyYearData.some(({ summary: s }) => !s.isCurrent) && (
                <p className={`text-[11px] font-medium mt-0.5 ${historyAccumulated >= 0 ? 'text-brand-400' : 'text-red-400'}`}>
                  {formatCurrency(Math.abs(historyAccumulated))} {historyAccumulated >= 0 ? 'sin usar' : 'excedido'} (meses previos)
                </p>
              )}
            </div>
            <button
              onClick={() => { const i = historyYears.indexOf(historyYear); if (i > 0) setHistoryYear(historyYears[i - 1]); }}
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
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: dotColor, boxShadow: s.isCurrent ? `0 0 6px ${dotColor}88` : undefined }} />
                          <span className={`text-sm font-semibold capitalize ${s.isCurrent ? 'text-white' : 'text-dark-200'}`}>{label}</span>
                          {s.isCurrent && <span className="text-[9px] font-bold bg-brand-500/20 text-brand-400 px-1.5 py-0.5 rounded-full">actual</span>}
                        </div>
                        <span className={`text-[11px] ${isOver ? 'text-red-400' : 'text-dark-400'}`}>{sPct.toFixed(1)}% gastado</span>
                      </div>
                      <div className="w-full bg-dark-700 rounded-full h-1.5 mb-1.5 overflow-hidden relative">
                        {!isOver && <div className="absolute right-0 top-0 h-full rounded-full"
                          style={{ width: `${availPct}%`, backgroundColor: dotColor }} />}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[11px] font-medium" style={{ color: dotColor }}>
                          {isOver ? `${formatCurrency(s.spent - pAmt)} excedido` : s.isCurrent ? `${formatCurrency(sLeft)} disponible` : `${formatCurrency(sLeft)} sin usar`}
                        </span>
                        <span className="text-[11px] text-dark-500">de {formatCurrency(pAmt)}</span>
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
    </div>
  );
}
