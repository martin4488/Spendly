'use client';

import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Category } from '@/types';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Edit3, X, Delete, History } from 'lucide-react';
import CategoryIcon from '@/components/ui/CategoryIcon';
import {
  format, parseISO, endOfMonth, addMonths,
  differenceInDays, isWithinInterval
} from 'date-fns';
import { es } from 'date-fns/locale';
import { getCategories } from '@/lib/categoryCache';
import { CatNode, buildTree } from '@/lib/categoryTree';
import Amount from '@/components/ui/Amount';

const AddExpenseModal = lazy(() => import('@/components/AddExpenseModal'));

interface Props {
  user: User;
  onBack: () => void;
  defaultCurrency?: string;
}

interface GlobalPeriod {
  month: string; // 'yyyy-MM'
  amount: number;
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
  children: CatSpend[];
}

interface MonthSummary {
  month: string;
  amount: number | null;
  spent: number;
  isCurrent: boolean;
}

function buildSpendTree(
  node: CatNode,
  spendMap: Record<string, number>,
  txMap: Record<string, number>,
): CatSpend {
  const childSpends = node.children
    .map(c => buildSpendTree(c, spendMap, txMap))
    .filter(c => c.spent > 0);
  const directSpent = spendMap[node.id] || 0;
  const spent = directSpent + childSpends.reduce((s, c) => s + c.spent, 0);
  const transactions = (txMap[node.id] || 0) + childSpends.reduce((s, c) => s + c.transactions, 0);
  return {
    id: node.id, name: node.name, icon: node.icon, color: node.color,
    spent, transactions, children: childSpends.sort((a, b) => b.spent - a.spent),
  };
}

export default function GlobalBudgetDetailView({ user, onBack, defaultCurrency }: Props) {
  const [periods, setPeriods] = useState<GlobalPeriod[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currentMonth, setCurrentMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthCache = useRef<Map<string, { expenses: ExpenseRow[]; total: number; catSpending: CatSpend[] }>>(new Map());

  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [catSpending, setCatSpending] = useState<CatSpend[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);

  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const [showHistory, setShowHistory] = useState(false);
  const [historySummaries, setHistorySummaries] = useState<MonthSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyYear, setHistoryYear] = useState<number>(new Date().getFullYear());

  const [showEditForm, setShowEditForm] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  const swipeStartX = useRef<number | null>(null);
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const yestStr = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');
  const nowMonth = format(now, 'yyyy-MM');

  useEffect(() => { init(); }, [user.id]);

  useEffect(() => {
    if (categories.length > 0) loadMonthData(currentMonth);
  }, [currentMonth, categories]);

  async function init() {
    setLoading(true);
    setError(null);
    monthCache.current.clear();
    try {
      const [{ data: periodsData }, catsMap] = await Promise.all([
        supabase.from('global_budget_periods').select('month, amount').eq('user_id', user.id),
        getCategories(user.id),
      ]);
      setPeriods((periodsData || []).map((p: any) => ({ month: p.month, amount: Number(p.amount) })));
      setCategories(Array.from(catsMap.values()));
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los datos');
    } finally {
      setLoading(false);
    }
  }

  async function loadMonthData(month: string) {
    const cached = monthCache.current.get(month);
    if (cached) {
      setExpenses(cached.expenses);
      setTotalSpent(cached.total);
      setCatSpending(cached.catSpending);
      return;
    }

    setLoading(true);
    try {
      const mStart = `${month}-01`;
      const mEnd = format(endOfMonth(new Date(`${month}-01`)), 'yyyy-MM-dd');

      const { data: expData } = await supabase
        .from('expenses')
        .select('id, amount, description, date, category_id')
        .eq('user_id', user.id)
        .gte('date', mStart)
        .lte('date', mEnd)
        .order('date', { ascending: false });

      const exps: ExpenseRow[] = (expData || []).map((e: any) => ({
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

      const tree = buildTree(categories);
      const catSpends: CatSpend[] = tree
        .map(node => buildSpendTree(node, spendByCat, txByCat))
        .filter(c => c.spent > 0)
        .sort((a, b) => b.spent - a.spent);

      monthCache.current.set(month, { expenses: exps, total, catSpending: catSpends });
      setExpenses(exps);
      setTotalSpent(total);
      setCatSpending(catSpends);
    } catch (err) {
      console.error(err);
      setError('Error al cargar gastos');
    } finally {
      setLoading(false);
    }
  }

  function getMonthAmount(month: string): number | null {
    const exact = periods.find(p => p.month === month);
    if (exact) return exact.amount;
    const prior = periods.filter(p => p.month < month).sort((a, b) => b.month.localeCompare(a.month));
    return prior.length > 0 ? prior[0].amount : null;
  }

  const monthAmount = getMonthAmount(currentMonth);

  async function loadHistorySummaries(year: number) {
    setHistoryLoading(true);
    try {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;

      const { data: expData } = await supabase
        .from('expenses')
        .select('amount, date')
        .eq('user_id', user.id)
        .gte('date', yearStart)
        .lte('date', yearEnd);

      const expList = (expData || []).map((e: any) => ({ amount: Number(e.amount), date: e.date as string }));

      const months: string[] = [];
      const maxMonth = year === now.getFullYear() ? nowMonth : `${year}-12`;
      for (let m = 1; m <= 12; m++) {
        const mo = `${year}-${String(m).padStart(2, '0')}`;
        if (mo > maxMonth) break;
        months.push(mo);
      }

      const summaries: MonthSummary[] = months.map(mo => {
        const mStart = `${mo}-01`;
        const mEnd = format(endOfMonth(new Date(`${mo}-01`)), 'yyyy-MM-dd');
        const spent = expList.filter(e => e.date >= mStart && e.date <= mEnd).reduce((s, e) => s + e.amount, 0);
        const amt = getMonthAmount(mo);
        return { month: mo, amount: amt, spent, isCurrent: mo === nowMonth };
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

  function navigateMonth(dir: -1 | 1) {
    const d = addMonths(new Date(`${currentMonth}-01`), dir);
    const next = format(d, 'yyyy-MM');
    if (next > nowMonth) return;
    setCurrentMonth(next);
  }

  function toggleExpand(catId: string) {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  function onTouchStart(e: React.TouchEvent) { swipeStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null) return;
    const dx = swipeStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 50) navigateMonth(dx > 0 ? -1 : 1);
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
      await supabase.from('global_budget_periods').upsert(
        { user_id: user.id, month: currentMonth, amount: newAmount },
        { onConflict: 'user_id,month' }
      );
      setPeriods(prev => {
        const filtered = prev.filter(p => p.month !== currentMonth);
        return [...filtered, { month: currentMonth, amount: newAmount }];
      });
      monthCache.current.delete(currentMonth);
      setShowEditForm(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function openExpenseEdit(exp: ExpenseRow) {
    setEditingExpense({
      id: exp.id, amount: Number(exp.amount), description: exp.description,
      category_id: exp.category_id, date: exp.date,
    });
    setShowExpenseModal(true);
  }

  // ── Derived data ──
  const periodDerived = useMemo(() => {
    const mStart = parseISO(`${currentMonth}-01`);
    const mEnd = endOfMonth(mStart);
    const isCurrentPeriod = isWithinInterval(now, { start: mStart, end: mEnd });
    const pct = monthAmount && monthAmount > 0 ? (totalSpent / monthAmount) * 100 : 0;
    const budgetColor = pct >= 100 ? '#ef4444' : (isCurrentPeriod && pct >= 80) ? '#f59e0b' : '#22c55e';
    const budgetTextColor = pct >= 100 ? 'text-red-400' : (isCurrentPeriod && pct >= 80) ? 'text-amber-400' : 'text-brand-400';
    const left = monthAmount ? Math.max(monthAmount - totalSpent, 0) : 0;
    const daysLeft = isCurrentPeriod ? Math.max(differenceInDays(mEnd, now), 0) : 0;
    const perDay = daysLeft > 0 ? left / daysLeft : 0;
    const periodLabel = format(mStart, 'MMMM yyyy', { locale: es });
    const hasNext = currentMonth < nowMonth;
    return { mStart, mEnd, isCurrentPeriod, pct, budgetColor, budgetTextColor, left, daysLeft, perDay, periodLabel, hasNext };
  }, [currentMonth, totalSpent, monthAmount]);

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

  const { histAccumulated, histAccumMonths, availableYears } = useMemo(() => {
    const closedItems = historySummaries.filter(s => !s.isCurrent && s.amount != null);
    const accumulated = closedItems.reduce((sum, s) => sum + ((s.amount || 0) - s.spent), 0);
    let accumMonths = '';
    if (closedItems.length > 0) {
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const sorted = [...closedItems].sort((a, b) => a.month.localeCompare(b.month));
      const fmt = (m: string) => cap(format(new Date(`${m}-01`), 'MMM', { locale: es }));
      const first = fmt(sorted[0].month);
      const last = fmt(sorted[sorted.length - 1].month);
      accumMonths = first === last ? first : `${first} - ${last}`;
    }
    const yearSet = new Set<number>();
    yearSet.add(now.getFullYear());
    periods.forEach(p => yearSet.add(parseInt(p.month.substring(0, 4))));
    const years = Array.from(yearSet).sort((a, b) => b - a);
    return { histAccumulated: accumulated, histAccumMonths: accumMonths, availableYears: years };
  }, [historySummaries, periods]);

  // Stacked bar data (top-level cats only)
  const catStackedBar = useMemo(() => {
    if (catSpending.length === 0) return [];
    const total = catSpending.reduce((s, c) => s + c.spent, 0);
    return catSpending.map(c => ({
      ...c,
      pct: total > 0 ? (c.spent / total) * 100 : 0,
    }));
  }, [catSpending]);

  const { mStart, mEnd, isCurrentPeriod, pct, budgetColor, budgetTextColor, left, daysLeft, perDay, periodLabel, hasNext } = periodDerived;

  // ── Category row renderer (recursive, collapsible) ──
  function renderCatRow(cat: CatSpend, depth: number, totalForPct: number) {
    const hasChildren = cat.children.length > 0;
    const isExpanded = expandedCats.has(cat.id);
    const catPct = totalForPct > 0 ? (cat.spent / totalForPct) * 100 : 0;

    return (
      <div key={cat.id}>
        <div
          className={`flex items-center gap-3 border-b border-dark-800/40 ${hasChildren ? 'cursor-pointer active:bg-dark-700/40' : ''}`}
          style={{ paddingLeft: `${16 + depth * 20}px`, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}
          onClick={hasChildren ? () => toggleExpand(cat.id) : undefined}
        >
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cat.color }} />
          <span className={`flex-1 min-w-0 ${depth === 0 ? 'text-[12px] font-medium text-dark-200' : 'text-[11px] text-dark-300'} truncate`}>
            {cat.name}
          </span>
          {hasChildren && (
            <ChevronDown
              size={12}
              className={`text-dark-500 flex-shrink-0 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`}
            />
          )}
          <span className="text-[11px] text-dark-500 mr-1">{Math.round(catPct)}%</span>
          <Amount value={cat.spent} currency={defaultCurrency} size="sm" color="text-dark-100" weight="bold" className="text-[12px] flex-shrink-0" decimals={false} />
        </div>
        {hasChildren && isExpanded && (
          <div>
            {cat.children.map(child => renderCatRow(child, depth + 1, totalForPct))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-8 page-transition" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>

      {/* HEADER */}
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <button onClick={onBack} className="p-1 text-dark-300"><ArrowLeft size={20} /></button>
        <div className="flex items-center gap-1">
          <button onClick={() => { setEditAmount(String(monthAmount || '')); setShowEditForm(true); }}
            className="p-1.5 text-dark-400 hover:text-white"><Edit3 size={16} /></button>
        </div>
      </div>

      {/* TITLE + PERIOD NAVIGATOR */}
      <div className="text-center mb-1 px-4">
        <h1 className="text-base font-bold">Gasto global</h1>
      </div>
      <div className="flex items-center justify-between px-4 mb-2">
        <button onClick={() => navigateMonth(-1)}
          className="p-1.5 rounded-full transition-colors text-dark-300 active:bg-dark-800">
          <ChevronLeft size={20} />
        </button>
        <p className="text-base font-bold capitalize">{periodLabel}</p>
        <button onClick={() => navigateMonth(1)} disabled={!hasNext}
          className={`p-1.5 rounded-full transition-colors ${hasNext ? 'text-dark-300 active:bg-dark-800' : 'text-dark-700 cursor-not-allowed'}`}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* HISTORY BUTTON — pill style */}
      <div className="flex justify-center pb-3 border-b border-dark-800/60">
        <button
          onClick={openHistory}
          className="inline-flex items-center gap-2 bg-dark-800 rounded-full px-4 py-2 active:bg-dark-700 transition-colors"
        >
          <History size={14} className="text-brand-400" />
          <span className="text-[13px] font-semibold text-dark-100">Historial</span>
          <ChevronRight size={13} className="text-dark-500" />
        </button>
      </div>

      {error ? (
        <div className="text-center py-10 text-red-400 px-4">{error}</div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : monthAmount == null ? (
        <div className="text-center py-16 px-4">
          <p className="text-dark-400 mb-4">No hay presupuesto configurado para este mes</p>
          <button onClick={() => { setEditAmount(''); setShowEditForm(true); }}
            className="bg-brand-600 text-white font-bold px-8 py-3.5 rounded-2xl text-sm">
            Configurar presupuesto
          </button>
          {totalSpent > 0 && (
            <div className="mt-8">
              <p className="text-dark-500 text-xs mb-2">Gasto del mes</p>
              <Amount value={totalSpent} currency={defaultCurrency} sign="-" size="lg" color="text-red-400" weight="extrabold" decimals={false} />
            </div>
          )}
        </div>
      ) : (
        <>
          {/* HERO AMOUNT */}
          <div className="px-4 pt-5 pb-1 text-center">
            {pct >= 100 ? (
              <>
                <Amount value={totalSpent - monthAmount} currency={defaultCurrency} size="xl" color="text-red-400" weight="extrabold" decimals={false} />
                <p className="text-red-400/70 text-[13px] font-semibold mt-1" style={{ opacity: 0.75 }}>excedido</p>
              </>
            ) : (
              <>
                <Amount value={left} currency={defaultCurrency} size="xl" color={budgetTextColor} weight="extrabold" decimals={false} />
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
                    ? <>Podés gastar <Amount value={perDay} currency={defaultCurrency} size="sm" color={budgetTextColor} weight="bold" decimals={false} />/día durante {daysLeft} días más.</>
                    : 'Último día del mes.'}
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

          {/* STATS ROW */}
          <div className="flex items-stretch border-t border-b border-dark-800/60 mt-4">
            <div className="flex-1 px-4 py-3 text-center border-r border-dark-800/60">
              <p className="text-[9px] font-semibold text-dark-500 uppercase tracking-wider mb-0.5">Gastado</p>
              <p className="text-[15px] font-bold text-red-400">
                {formatCurrency(totalSpent, defaultCurrency, true)}
                <span className="text-[11px] font-normal text-dark-500 ml-1">/ {formatCurrency(monthAmount, defaultCurrency, true)}</span>
              </p>
            </div>
            <div className="flex-1 px-4 py-3 text-center">
              <p className="text-[9px] font-semibold text-dark-500 uppercase tracking-wider mb-0.5">% gastado</p>
              <p className="text-[15px] font-bold text-dark-100">{pct.toFixed(1)}%</p>
            </div>
          </div>

          {/* CATEGORY BREAKDOWN — stacked bar + collapsible rows */}
          {catSpending.length > 0 && catStackedBar.length > 0 && (
            <div className="mt-1">
              <p className="px-4 pt-3 pb-2 text-[10px] font-semibold text-dark-500 uppercase tracking-wider">Por categoría</p>

              {/* Stacked bar */}
              <div className="mx-4 mb-2 h-2.5 rounded-full overflow-hidden flex gap-px">
                {catStackedBar.map(cat => (
                  <div key={cat.id} style={{ width: `${cat.pct}%`, background: cat.color }} />
                ))}
              </div>

              {/* Category rows (collapsible) */}
              <div>
                {catSpending.map(cat => renderCatRow(cat, 0, catSpending.reduce((s, c) => s + c.spent, 0)))}
              </div>
            </div>
          )}

          {/* TRANSACTIONS */}
          {grouped.length === 0 ? (
            <div className="text-center py-10"><p className="text-dark-500 text-sm">Sin gastos este mes</p></div>
          ) : (
            <div>
              <p className="px-4 pt-3 pb-1 text-sm font-bold">Transacciones</p>
              {grouped.map(group => (
                <div key={group.date}>
                  <div className="flex items-center justify-between px-4 py-1.5 bg-dark-800/60">
                    <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wider capitalize">{group.label}</span>
                    <Amount value={group.total} currency={defaultCurrency} sign="-" size="sm" weight="semibold" color="text-dark-500" className="text-[10px]" decimals={false} />
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
                        <Amount value={exp.amount} currency={defaultCurrency} sign="-" size="sm" color="text-red-400" weight="bold" className="flex-shrink-0" decimals={false} />
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
            <h2 className="text-base font-bold">Historial · Gasto global</h2>
            <div className="w-8" />
          </div>
          <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
            <button
              onClick={() => { const i = availableYears.indexOf(historyYear); if (i < availableYears.length - 1) changeHistoryYear(availableYears[i + 1]); }}
              disabled={availableYears.indexOf(historyYear) >= availableYears.length - 1}
              className="p-2 rounded-xl bg-dark-800 text-dark-300 disabled:opacity-30 active:bg-dark-700">
              <ChevronLeft size={18} />
            </button>
            <div className="text-center">
              <p className="text-base font-bold">{historyYear}</p>
              {historySummaries.some(s => !s.isCurrent && s.amount != null) && (
                <p className={`text-[11px] font-medium mt-0.5 ${histAccumulated >= 0 ? 'text-brand-400' : 'text-red-400'}`}>
                  {formatCurrency(Math.abs(histAccumulated), undefined, true)} {histAccumulated >= 0 ? 'ahorro acumulado' : 'excedido acumulado'} en {historyYear}{histAccumMonths ? ` (${histAccumMonths})` : ''}
                </p>
              )}
            </div>
            <button
              onClick={() => { const i = availableYears.indexOf(historyYear); if (i > 0) changeHistoryYear(availableYears[i - 1]); }}
              disabled={availableYears.indexOf(historyYear) <= 0}
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
            ) : historySummaries.length === 0 ? (
              <div className="text-center py-16 text-dark-500">Sin datos para {historyYear}</div>
            ) : (
              <div className="px-4 py-2 flex flex-col gap-1">
                {historySummaries.map(s => {
                  const pAmt = s.amount;
                  const sPct = pAmt && pAmt > 0 ? (s.spent / pAmt) * 100 : 0;
                  const sLeft = pAmt ? Math.max(pAmt - s.spent, 0) : 0;
                  const label = format(new Date(`${s.month}-01`), 'MMMM', { locale: es });
                  const isOver = pAmt ? s.spent > pAmt : false;
                  const dotColor = isOver ? '#ef4444' : (s.isCurrent && sPct >= 80) ? '#f59e0b' : '#22c55e';
                  const availPct = Math.max(100 - sPct, 0);
                  const noBudget = pAmt == null;

                  return (
                    <button key={s.month}
                      onClick={() => { setCurrentMonth(s.month); setShowHistory(false); }}
                      className={`w-full text-left px-4 py-3 rounded-2xl active:bg-dark-800/60 transition-colors ${s.isCurrent ? 'bg-dark-800/60' : ''}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: noBudget ? '#64748b' : dotColor, boxShadow: s.isCurrent ? `0 0 6px ${noBudget ? '#64748b88' : dotColor + '88'}` : undefined }} />
                          <span className={`text-sm font-semibold capitalize ${s.isCurrent ? 'text-white' : 'text-dark-200'}`}>{label}</span>
                          {s.isCurrent && <span className="text-[9px] font-bold bg-brand-500/20 text-brand-400 px-1.5 py-0.5 rounded-full">actual</span>}
                        </div>
                        {noBudget ? (
                          <span className="text-[11px] text-dark-500">sin presupuesto</span>
                        ) : (
                          <span className={`text-[11px] ${isOver ? 'text-red-400' : 'text-dark-400'}`}>{sPct.toFixed(1)}% gastado</span>
                        )}
                      </div>
                      {!noBudget && (
                        <div className="w-full bg-dark-700 rounded-full h-1.5 mb-1.5 overflow-hidden relative">
                          {!isOver && <div className="absolute right-0 top-0 h-full rounded-full"
                            style={{ width: `${availPct}%`, backgroundColor: dotColor }} />}
                        </div>
                      )}
                      <div className="flex justify-between">
                        {noBudget ? (
                          <span className="text-[11px] text-dark-400">{s.spent > 0 ? `${formatCurrency(s.spent, undefined, true)} gastado` : 'Sin gastos'}</span>
                        ) : (
                          <>
                            <span className="text-[11px] font-medium" style={{ color: dotColor }}>
                              {isOver ? `${formatCurrency(s.spent - pAmt!, undefined, true)} excedido` : s.isCurrent ? `${formatCurrency(sLeft, undefined, true)} disponible` : `${formatCurrency(sLeft, undefined, true)} sin usar`}
                            </span>
                            <span className="text-[11px] text-dark-500">de {formatCurrency(pAmt!, undefined, true)}</span>
                          </>
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
            <h2 className="text-base font-bold">Presupuesto mensual</h2>
            <div className="w-8" />
          </div>
          <div className="px-5 py-6 flex-shrink-0 border-b border-dark-800 text-center">
            <p className="text-xs text-dark-400 mb-1 capitalize">Monto para {format(new Date(`${currentMonth}-01`), 'MMMM yyyy', { locale: es })}</p>
            <p className="text-4xl font-extrabold">{editAmount || '0'}</p>
          </div>
          <div className="flex-1" />
          <div className="flex-shrink-0">
            <div className="px-5 py-3">
              <button onClick={handleSaveAmount} disabled={saving || !editAmount || isNaN(parseFloat(editAmount))}
                className="w-full bg-brand-600 disabled:opacity-30 text-white font-bold py-4 rounded-2xl text-base">
                {saving ? 'Guardando...' : 'Guardar'}
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
            defaultCurrency={defaultCurrency as any}
            onClose={() => { setShowExpenseModal(false); setEditingExpense(null); }}
            onSaved={() => {
              monthCache.current.clear();
              loadMonthData(currentMonth);
            }}
            editingExpense={editingExpense}
          />
        </Suspense>
      )}
    </div>
  );
}
