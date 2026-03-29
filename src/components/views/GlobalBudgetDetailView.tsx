'use client';

import React, { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Edit3, Delete, X, Trash2 } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CurrencyCode } from '@/lib/currency';
import { getCategories } from '@/lib/categoryCache';

interface Props {
  user: User;
  onBack: () => void;
  defaultCurrency: CurrencyCode;
}

interface MonthPeriod {
  month: string; // yyyy-MM
  amount: number;
  spent: number;
  isCurrent: boolean;
}

interface CatSpend {
  id: string;
  name: string;
  icon: string;
  color: string;
  spent: number;
  children: CatSpend[];
}

interface RawCat { id: string; name: string; icon: string; color: string; parent_id: string | null; }
interface CatNode extends RawCat { children: CatNode[]; }

function buildCatTree(flat: RawCat[]): CatNode[] {
  const map = new Map<string, CatNode>();
  flat.forEach(c => map.set(c.id, { ...c, children: [] }));
  const roots: CatNode[] = [];
  flat.forEach(c => {
    if (c.parent_id && map.has(c.parent_id)) map.get(c.parent_id)!.children.push(map.get(c.id)!);
    else roots.push(map.get(c.id)!);
  });
  return roots;
}

function buildCatSpend(node: CatNode, spendMap: Record<string, number>): CatSpend {
  const children = node.children.map(c => buildCatSpend(c, spendMap)).filter(c => c.spent > 0);
  const ownSpent = spendMap[node.id] || 0;
  const spent = ownSpent + children.reduce((s, c) => s + c.spent, 0);
  return { id: node.id, name: node.name, icon: node.icon, color: node.color, spent, children };
}

interface ExpenseRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  category_id: string | null;
  category?: { name: string; icon: string; color: string } | null;
}

function monthStart(month: string) { return `${month}-01`; }
function monthEnd(month: string) {
  const d = new Date(`${month}-01`);
  return format(endOfMonth(d), 'yyyy-MM-dd');
}

export default function GlobalBudgetDetailView({ user, onBack, defaultCurrency }: Props) {
  const now = new Date();
  const currentMonth = format(now, 'yyyy-MM');

  const [months, setMonths] = useState<MonthPeriod[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [catSpending, setCatSpending] = useState<CatSpend[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [historyYear, setHistoryYear] = useState(now.getFullYear());
  const [showEditForm, setShowEditForm] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editAmount, setEditAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const cache = useRef<Map<string, { expenses: ExpenseRow[]; cats: CatSpend[] }>>(new Map());
  const swipeStartX = useRef<number | null>(null);

  useEffect(() => { init(); }, []);
  useEffect(() => {
    if (months.length > 0) loadMonthData(currentIndex);
  }, [currentIndex, months]);

  async function init() {
    setLoading(true);
    try {
      const { data: periodsData } = await supabase
        .from('global_budget_periods')
        .select('*')
        .eq('user_id', user.id)
        .order('month', { ascending: false });

      const periods = periodsData || [];
      const periodMap: Record<string, number> = {};
      periods.forEach((p: any) => { periodMap[p.month] = p.amount; });

      const firstMonth = periods.length > 0 ? periods[periods.length - 1].month : currentMonth;

      // Load ALL expenses from firstMonth to now in one query (categories loaded per-month in loadMonthData)
      const firstDate = `${firstMonth}-01`;
      const lastDate = format(endOfMonth(new Date()), 'yyyy-MM-dd');
      const { data: expData } = await supabase
        .from('expenses')
        .select('date, amount')
        .eq('user_id', user.id)
        .gte('date', firstDate)
        .lte('date', lastDate);

      // Aggregate by month
      const spentByMonth: Record<string, number> = {};
      (expData || []).forEach((e: any) => {
        const mo = e.date.slice(0, 7);
        spentByMonth[mo] = (spentByMonth[mo] || 0) + Number(e.amount);
      });

      const monthList: MonthPeriod[] = [];
      let m = currentMonth;
      while (m >= firstMonth) {
        monthList.push({
          month: m,
          amount: periodMap[m] ?? 0,
          spent: spentByMonth[m] || 0,
          isCurrent: m === currentMonth,
        });
        const d = subMonths(new Date(`${m}-01`), 1);
        m = format(d, 'yyyy-MM');
      }

      setMonths(monthList);
      setCurrentIndex(0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadMonthData(index: number) {
    if (months.length === 0) return;
    const period = months[index];
    if (!period) return;

    const cached = cache.current.get(period.month);
    if (cached) {
      setExpenses(cached.expenses);
      setCatSpending(cached.cats);
      setEditAmount(String(period.amount));
      return;
    }

    setLoading(true);
    try {
      const start = monthStart(period.month);
      const end = monthEnd(period.month);

      const { data: expData } = await supabase
        .from('expenses')
        .select('id, amount, description, date, category_id, category:categories(name, icon, color)')
        .eq('user_id', user.id)
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: false });

      const exps: ExpenseRow[] = (expData || []).map((e: any) => ({
        id: e.id,
        date: e.date,
        description: e.description,
        amount: Number(e.amount),
        category_id: e.category_id,
        category: e.category,
      }));

      const spendMap: Record<string, number> = {};
      exps.forEach(e => {
        if (e.category_id) spendMap[e.category_id] = (spendMap[e.category_id] || 0) + e.amount;
      });
      // Load categories to build tree
      const catsMap = await getCategories(user.id);
      const tree = buildCatTree(Array.from(catsMap.values()));
      const cats: CatSpend[] = tree
        .map(node => buildCatSpend(node, spendMap))
        .filter(c => c.spent > 0)
        .sort((a, b) => b.spent - a.spent);

      const totalSpent = exps.reduce((s, e) => s + e.amount, 0);
      setMonths(prev => prev.map((p, i) => i === index ? { ...p, spent: totalSpent } : p));
      cache.current.set(period.month, { expenses: exps, cats });
      setExpenses(exps);
      setCatSpending(cats);
      setEditAmount(String(period.amount));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteGlobal() {
    if (!confirm('¿Eliminar el presupuesto global? Los datos históricos se conservan.')) return;
    await supabase.from('global_budget_periods').delete().eq('user_id', user.id);
    onBack();
  }

  async function handleSaveAmount() {
    if (!editAmount || isNaN(parseFloat(editAmount))) return;
    setSaving(true);
    try {
      const newAmount = parseFloat(editAmount);
      const period = months[currentIndex];
      const startMonthInput = (document.getElementById('global-edit-start-month') as HTMLInputElement)?.value || period.month;

      // Upsert all months from startMonth to current (and future existing ones with same amount)
      const curMonth = format(new Date(), 'yyyy-MM');
      const upserts: { user_id: string; month: string; amount: number }[] = [];
      let m = startMonthInput;
      while (m <= curMonth) {
        upserts.push({ user_id: user.id, month: m, amount: newAmount });
        const d = new Date(`${m}-01`);
        d.setMonth(d.getMonth() + 1);
        m = format(d, 'yyyy-MM');
      }
      await supabase.from('global_budget_periods').upsert(upserts, { onConflict: 'user_id,month' });

      setMonths(prev => prev.map(p =>
        p.month >= startMonthInput ? { ...p, amount: newAmount } : p
      ));
      cache.current.clear();
      setShowEditForm(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleNumpad(key: string) {
    if (key === 'backspace') { setEditAmount(prev => prev.slice(0, -1)); }
    else if (key === '.') { if (!editAmount.includes('.')) setEditAmount(prev => (prev || '0') + '.'); }
    else {
      if (editAmount.includes('.')) { const [, d] = editAmount.split('.'); if (d?.length >= 2) return; }
      setEditAmount(prev => prev === '0' ? key : prev + key);
    }
  }

  function navigate(dir: 1 | -1) {
    const next = currentIndex + dir;
    if (next >= 0 && next < months.length) setCurrentIndex(next);
  }

  function renderCatRow(cat: CatSpend, depth: number): React.ReactNode {
    const activeChildren = cat.children.filter(c => c.spent > 0);
    const hasChildren = activeChildren.length > 0;
    const isExpanded = expanded.has(cat.id);
    const indent = depth * 16;
    return (
      <div key={cat.id} className="border-b border-dark-800/40">
        <div className="flex items-center gap-2.5 py-2.5" style={{ paddingLeft: `${12 + indent}px`, paddingRight: 12 }}>
          <div className="rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ width: depth === 0 ? 36 : 28, height: depth === 0 ? 36 : 28, fontSize: depth === 0 ? 16 : 13, backgroundColor: cat.color }}>
            {cat.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-semibold truncate ${depth === 0 ? 'text-[12px]' : 'text-[11px] text-dark-200'}`}>{cat.name}</p>
          </div>
          <span className={`font-bold text-red-400 flex-shrink-0 ${depth === 0 ? 'text-[12px]' : 'text-[11px]'}`}>
            -{formatCurrency(cat.spent)}
          </span>
          {hasChildren ? (
            <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id); return n; })} className="p-0.5 text-dark-500 ml-0.5">
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : <div className="w-5" />}
        </div>
        {hasChildren && isExpanded && (
          <div className="border-l border-dark-700/40 ml-8">
            {activeChildren.map(child => renderCatRow(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  if (loading && months.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  const period = months[currentIndex];
  if (!period) return null;

  const pct = period.amount > 0 ? (period.spent / period.amount) * 100 : 0;
  const left = Math.max(period.amount - period.spent, 0);
  const isOver = period.spent > period.amount;
  const budgetColor = isOver ? '#ef4444' : (!period.isCurrent && pct >= 80) ? '#22c55e' : (period.isCurrent && pct >= 80) ? '#f59e0b' : '#22c55e';
  const budgetTextColor = isOver ? 'text-red-400' : (period.isCurrent && pct >= 80) ? 'text-amber-400' : 'text-brand-400';

  // Accumulated for current year (closed months only)
  const historyByYear: Record<number, MonthPeriod[]> = {};
  months.forEach(m => {
    const y = parseInt(m.month.slice(0, 4));
    if (!historyByYear[y]) historyByYear[y] = [];
    historyByYear[y].push(m);
  });
  const historyYears = Object.keys(historyByYear).map(Number).sort((a, b) => b - a);
  const historyYearData = historyByYear[historyYear] || [];
  const closedHistMonths = historyYearData.filter(m => !m.isCurrent && m.amount > 0);
  const historyAccumulated = closedHistMonths.reduce((sum, m) => sum + (m.amount - m.spent), 0);
  const histAccumMonths = (() => {
    if (closedHistMonths.length === 0) return '';
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const fmt = (mo: string) => cap(format(parseISO(`${mo}-01`), 'MMM', { locale: es }));
    const sorted = [...closedHistMonths].sort((a, b) => a.month.localeCompare(b.month));
    const first = fmt(sorted[0].month);
    const last = fmt(sorted[sorted.length - 1].month);
    return first === last ? first : `${first} - ${last}`;
  })();

  const todayStr = format(now, 'yyyy-MM-dd');
  const yesterdayStr = format(subMonths(now, 0), 'yyyy-MM-dd');
  const dayMap = new Map<string, ExpenseRow[]>();
  expenses.forEach(e => {
    if (!dayMap.has(e.date)) dayMap.set(e.date, []);
    dayMap.get(e.date)!.push(e);
  });
  const yesterday = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');
  const grouped = Array.from(dayMap.entries())
    .map(([date, exps]) => ({
      date,
      label: date === todayStr ? 'Hoy' : date === yesterday ? 'Ayer' : format(parseISO(date), "d 'de' MMMM", { locale: es }),
      total: exps.reduce((s, e) => s + e.amount, 0),
      expenses: exps,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const periodLabel = format(parseISO(`${period.month}-01`), 'MMMM yyyy', { locale: es });

  return (
    <div className="max-w-lg mx-auto pb-8 page-transition"
      onTouchStart={e => { swipeStartX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (swipeStartX.current === null) return;
        const dx = swipeStartX.current - e.changedTouches[0].clientX;
        if (Math.abs(dx) > 50) navigate(dx > 0 ? 1 : -1);
        swipeStartX.current = null;
      }}>

      {/* HEADER */}
      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <button onClick={onBack} className="p-1 text-dark-300"><ArrowLeft size={20} /></button>
        <div className="flex items-center gap-1">
          <button onClick={() => { setEditAmount(String(period.amount || '')); setShowEditForm(true); }} className="p-1.5 text-dark-400 hover:text-white"><Edit3 size={16} /></button>
          <button onClick={handleDeleteGlobal} className="p-1.5 text-dark-400 hover:text-red-400"><Trash2 size={16} /></button>
        </div>
      </div>

      {/* TITLE + NAVIGATOR */}
      <div className="text-center mb-1 px-4">
        <h1 className="text-base font-bold">Gasto global</h1>
      </div>
      <div className="flex items-center justify-between px-4 mb-2">
        <button onClick={() => navigate(1)} disabled={currentIndex >= months.length - 1}
          className={`p-1.5 rounded-full transition-colors ${currentIndex < months.length - 1 ? 'text-dark-300 active:bg-dark-800' : 'text-dark-700 cursor-not-allowed'}`}>
          <ChevronLeft size={20} />
        </button>
        <p className="text-base font-bold capitalize">{periodLabel}</p>
        <button onClick={() => navigate(-1)} disabled={currentIndex <= 0}
          className={`p-1.5 rounded-full transition-colors ${currentIndex > 0 ? 'text-dark-300 active:bg-dark-800' : 'text-dark-700 cursor-not-allowed'}`}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* BUDGET HISTORY BUTTON */}
      <div className="px-3 pb-2">
        <button onClick={() => setShowHistory(true)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-dark-400 hover:text-dark-200 transition-colors">
          <span className="text-[11px] font-medium text-brand-400">⏱</span>
          <span className="text-[11px] font-medium">Budget History</span>
          <ChevronRight size={12} className="text-dark-500" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : period.amount === 0 ? (
        <div className="text-center py-10 px-4">
          <p className="text-dark-400 text-sm mb-4">No hay presupuesto configurado para este mes</p>
          <button onClick={() => { setEditAmount(''); setShowEditForm(true); }}
            className="bg-brand-600 text-white font-bold px-6 py-3 rounded-2xl text-sm">
            Configurar presupuesto
          </button>
        </div>
      ) : (
        <>
          {/* AMOUNT */}
          <div className="px-4 mb-4 text-center">
            {isOver ? (
              <>
                <p className="text-4xl font-extrabold text-red-400">{formatCurrency(period.spent - period.amount)}</p>
                <p className="text-red-400/70 text-sm mt-0.5">excedido de {formatCurrency(period.amount)}</p>
              </>
            ) : (
              <>
                <p className={`text-4xl font-extrabold ${budgetTextColor}`}>{formatCurrency(left)}</p>
                <p className="text-dark-500 text-sm mt-0.5">{period.isCurrent ? 'disponible' : 'sin usar'} de {formatCurrency(period.amount)}</p>
              </>
            )}
          </div>

          {/* PROGRESS BAR */}
          <div className="px-4 mb-5">
            <div className="w-full bg-dark-700 rounded-full h-2.5 overflow-hidden relative">
              {!isOver && (
                <div className="absolute right-0 top-0 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(100 - pct, 0)}%`, backgroundColor: budgetColor }} />
              )}
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-dark-500">
                {format(parseISO(`${period.month}-01`), 'd MMM', { locale: es })}
              </span>
              <span className={`text-[10px] font-bold ${isOver ? 'text-red-400' : 'text-dark-400'}`}>
                {pct.toFixed(1)}% gastado
              </span>
              <span className="text-[10px] text-dark-500">
                {format(endOfMonth(parseISO(`${period.month}-01`)), 'd MMM', { locale: es })}
              </span>
            </div>
          </div>

          {/* DOTS */}
          {months.length > 1 && (
            <div className="flex justify-center gap-1.5 mb-5">
              {months.slice(0, Math.min(months.length, 12)).map((_, i) => {
                const visibleCount = Math.min(months.length, 12);
                const reversedI = visibleCount - 1 - i;
                const isActive = reversedI === currentIndex;
                return (
                  <button key={i} onClick={() => setCurrentIndex(reversedI)}
                    className="w-2 h-2 rounded-full flex-shrink-0 transition-all"
                    style={{ backgroundColor: isActive ? budgetColor : '#334155' }} />
                );
              })}
            </div>
          )}

          {/* TOTAL */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-b border-dark-800/60 mb-1">
            <span className="text-xs text-dark-400 font-medium uppercase tracking-wider">Total gastado</span>
            <span className="text-base font-bold text-red-400">-{formatCurrency(period.spent)}</span>
          </div>

          {/* CATEGORY BREAKDOWN */}
          {catSpending.length > 0 && (
            <div className="mb-5">
              {catSpending.map(cat => renderCatRow(cat, 0))}
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
            <button onClick={() => { const i = historyYears.indexOf(historyYear); if (i < historyYears.length - 1) setHistoryYear(historyYears[i + 1]); }}
              disabled={historyYears.indexOf(historyYear) >= historyYears.length - 1}
              className="p-2 rounded-xl bg-dark-800 text-dark-300 disabled:opacity-30 active:bg-dark-700">
              <ChevronLeft size={18} />
            </button>
            <div className="text-center">
              <p className="text-base font-bold">{historyYear}</p>
              {historyYearData.some(m => !m.isCurrent && m.amount > 0) && (
                <p className={`text-[11px] font-medium mt-0.5 ${historyAccumulated >= 0 ? 'text-brand-400' : 'text-red-400'}`}>
                  {formatCurrency(Math.abs(historyAccumulated))} {historyAccumulated >= 0 ? 'ahorro acumulado' : 'excedido acumulado'} en {historyYear}{histAccumMonths ? ` (${histAccumMonths})` : ''}
                </p>
              )}
            </div>
            <button onClick={() => { const i = historyYears.indexOf(historyYear); if (i > 0) setHistoryYear(historyYears[i - 1]); }}
              disabled={historyYears.indexOf(historyYear) <= 0}
              className="p-2 rounded-xl bg-dark-800 text-dark-300 disabled:opacity-30 active:bg-dark-700">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="h-px bg-dark-800 mx-4 mb-1 flex-shrink-0" />
          <div className="flex-1 overflow-y-auto pb-8">
            {historyYearData.length === 0 ? (
              <div className="text-center py-16 text-dark-500">Sin datos para {historyYear}</div>
            ) : (
              <div className="px-4 py-2 flex flex-col gap-1">
                {historyYearData.map((m, i) => {
                  const mPct = m.amount > 0 ? (m.spent / m.amount) * 100 : 0;
                  const mLeft = Math.max(m.amount - m.spent, 0);
                  const mOver = m.spent > m.amount;
                  const mColor = mOver ? '#ef4444' : (m.isCurrent && mPct >= 80) ? '#f59e0b' : '#22c55e';
                  const mAvailPct = Math.max(100 - mPct, 0);
                  const originalIndex = months.findIndex(mp => mp.month === m.month);
                  return (
                    <button key={m.month}
                      onClick={() => { if (originalIndex >= 0) setCurrentIndex(originalIndex); setHistoryYear(now.getFullYear()); setShowHistory(false); }}
                      className={`w-full text-left px-4 py-3 rounded-2xl active:bg-dark-800/60 transition-colors ${m.isCurrent ? 'bg-dark-800/60' : ''}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: mColor, boxShadow: m.isCurrent ? `0 0 6px ${mColor}88` : undefined }} />
                          <span className={`text-sm font-semibold capitalize ${m.isCurrent ? 'text-white' : 'text-dark-200'}`}>
                            {format(parseISO(`${m.month}-01`), 'MMMM', { locale: es })}
                          </span>
                          {m.isCurrent && <span className="text-[9px] font-bold bg-brand-500/20 text-brand-400 px-1.5 py-0.5 rounded-full">actual</span>}
                        </div>
                        <span className={`text-[11px] ${mOver ? 'text-red-400' : 'text-dark-400'}`}>{mPct.toFixed(1)}% gastado</span>
                      </div>
                      {m.amount === 0 ? (
                        <p className="text-[11px] text-dark-500 mb-1">Sin presupuesto configurado</p>
                      ) : (
                        <>
                          <div className="w-full bg-dark-700 rounded-full h-1.5 mb-1.5 overflow-hidden relative">
                            {!mOver && <div className="absolute right-0 top-0 h-full rounded-full" style={{ width: `${mAvailPct}%`, backgroundColor: mColor }} />}
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[11px] font-medium" style={{ color: mColor }}>
                              {mOver ? `${formatCurrency(m.spent - m.amount)} excedido` : m.isCurrent ? `${formatCurrency(mLeft)} disponible` : `${formatCurrency(mLeft)} sin usar`}
                            </span>
                            <span className="text-[11px] text-dark-500">de {formatCurrency(m.amount)}</span>
                          </div>
                        </>
                      )}
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
            <p className="text-xs text-dark-400 mb-3">Monto a partir de este mes en adelante</p>
            <p className="text-4xl font-extrabold mb-4">{editAmount || '0'}</p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-dark-400 whitespace-nowrap">Desde</label>
              <input type="month" defaultValue={period.month}
                id="global-edit-start-month"
                max={format(new Date(), 'yyyy-MM')}
                className="flex-1 bg-dark-800 border border-dark-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-dark-500" />
            </div>
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
                {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map((key) => (
                  <button key={key} onClick={() => handleNumpad(key)}
                    className="py-[14px] text-center text-xl font-medium border-b border-r border-dark-800 active:bg-dark-700 transition-colors bg-dark-900 text-white">
                    {key === 'backspace' ? <span className="flex items-center justify-center"><Delete size={22} /></span> : key}
                  </button>
                ))}
              </div>
              <div className="h-[env(safe-area-inset-bottom)]" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
