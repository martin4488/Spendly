'use client';

import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense, memo } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, getYearRange } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Expense, Category } from '@/types';
import { Plus, Trash2, ChevronRight, PieChart, Search, X } from 'lucide-react';
import type { CurrencyCode } from '@/lib/currency';

// Lazy-load the heavy modal — not needed until user taps +
const AddExpenseModal = lazy(() => import('@/components/AddExpenseModal'));

type ViewMode = 'months' | 'years';

function formatCompact(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

// ── Custom chart matching Wallet iOS style ────────────────────────────────────
function WalletChart({
  data,
}: {
  data: { name: string; year: string; total: number; isCurrent: boolean }[];
}) {
  const W = 340;
  const H = 130;
  const padL = 4;
  const padR = 4;
  const padTop = 24;
  const padBottom = 32;
  const plotH = H - padTop - padBottom;
  const plotW = W - padL - padR;

  const maxVal = Math.max(...data.map(d => d.total), 1);
  const midVal = maxVal / 2;
  const topVal = maxVal * 1.05;

  const toY = (v: number) => padTop + plotH - (v / topVal) * plotH;
  const baseY = toY(0);
  const midY = toY(midVal);
  const topY = toY(topVal);

  const n = data.length;
  const slotW = plotW / n;
  const barW = slotW * 0.45;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      <line x1={padL} y1={topY} x2={W - padR} y2={topY} stroke="#2d3f55" strokeDasharray="3 3" strokeWidth={1} />
      <text x={padL + 2} y={topY - 3} fill="#64748b" fontSize={10}>{formatCompact(topVal)}</text>
      <line x1={padL} y1={midY} x2={W - padR} y2={midY} stroke="#2d3f55" strokeDasharray="3 3" strokeWidth={1} />
      <text x={padL + 2} y={midY - 3} fill="#64748b" fontSize={10}>{formatCompact(midVal)}</text>
      <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="#2d3f55" strokeDasharray="3 3" strokeWidth={1} />
      <text x={padL + 2} y={baseY - 3} fill="#64748b" fontSize={10}>0</text>
      <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="#3d5068" strokeWidth={1.5} />

      {data.map((entry, i) => {
        const cx = padL + i * slotW + slotW / 2;
        const barH = Math.max((entry.total / topVal) * plotH, entry.total > 0 ? 2 : 0);
        const barX = cx - barW / 2;
        const barY = baseY - barH;
        return (
          <g key={i}>
            <rect x={barX} y={barY} width={barW} height={barH} rx={2}
              fill={entry.isCurrent ? '#ef4444' : 'rgba(239,68,68,0.55)'} />
            <text x={cx} y={baseY + 13} textAnchor="middle"
              fill={entry.isCurrent ? '#94a3b8' : '#64748b'} fontSize={11}
              fontWeight={entry.isCurrent ? 600 : 400}>
              {entry.name}
            </text>
            {entry.year && (
              <text x={cx} y={baseY + 24} textAnchor="middle" fill="#475569" fontSize={9}>
                {entry.year}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Memoized swipeable expense row ───────────────────────────────────────────
const SwipeableExpenseRow = memo(function SwipeableExpenseRow({
  expense,
  onEdit,
  onDelete,
}: {
  expense: Expense;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const currentXRef = useRef<number>(0);
  const DELETE_THRESHOLD = 72;
  const SNAP_THRESHOLD = 36;

  const cat = (expense as any).category;

  function onTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0].clientX;
    setIsDragging(false);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startXRef.current === null) return;
    const dx = startXRef.current - e.touches[0].clientX;
    if (dx > 5) setIsDragging(true);
    if (dx > 0) {
      currentXRef.current = Math.min(dx, DELETE_THRESHOLD);
      setOffset(currentXRef.current);
    } else if (dx < 0 && offset > 0) {
      currentXRef.current = Math.max(0, offset + dx);
      setOffset(currentXRef.current);
    }
  }

  function onTouchEnd() {
    if (currentXRef.current > SNAP_THRESHOLD) {
      setOffset(DELETE_THRESHOLD);
    } else {
      setOffset(0);
    }
    startXRef.current = null;
  }

  function handleRowClick() {
    if (isDragging) return;
    if (offset > 0) { setOffset(0); } else { onEdit(); }
  }

  return (
    <div className="relative overflow-hidden border-b border-dark-800/40">
      <div className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500"
        style={{ width: DELETE_THRESHOLD }}>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="flex flex-col items-center justify-center w-full h-full gap-1 active:bg-red-600 transition-colors">
          <Trash2 size={18} className="text-white" />
          <span className="text-[10px] text-white font-medium">Borrar</span>
        </button>
      </div>

      <div
        className="flex items-center gap-2.5 px-3 py-2 bg-dark-900 active:bg-dark-800/60 transition-colors cursor-pointer select-none"
        style={{
          transform: `translateX(-${offset}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleRowClick}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
          style={{ backgroundColor: cat?.color ?? '#475569' }}>
          {cat?.icon || '💵'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold truncate leading-tight">{cat?.name || 'Sin categoría'}{expense.is_recurring && ' 🔄'}</p>
          {expense.description && expense.description !== (cat?.name || '') && (
            <p className="text-[10px] text-dark-500 mt-0.5 leading-tight truncate">{expense.description}</p>
          )}
        </div>
        <span className="text-[12px] font-bold text-red-400 flex-shrink-0">
          -{formatCurrency(Number(expense.amount))}
        </span>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardView({ user, onNavigate, defaultCurrency }: { user: User; onNavigate: (tab: any) => void; defaultCurrency: CurrencyCode }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartTotals, setChartTotals] = useState<Record<string, number>>({});
  const [yearTotals, setYearTotals] = useState<Record<number, number>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('months');
  const [extendedLoaded, setExtendedLoaded] = useState(false);
  const oldestDate = useRef<string>('');
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadInitial(); }, []);

  useEffect(() => {
    if (showSearch && searchRef.current) searchRef.current.focus();
  }, [showSearch]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && hasMore && viewMode === 'months') {
          loadMoreMonths();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadingMore, hasMore, viewMode, oldestDate.current]);

  async function loadInitial() {
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const chartStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;
      oldestDate.current = startStr;

      const [{ data: exp }, { data: chartExp }] = await Promise.all([
        supabase.from('expenses').select('*, category:categories(*)').eq('user_id', user.id).gte('date', startStr).order('date', { ascending: false }),
        supabase.from('expenses').select('date, amount').eq('user_id', user.id).gte('date', chartStart),
      ]);

      setExpenses(exp || []);
      const totals: Record<string, number> = {};
      (chartExp || []).forEach((e: any) => {
        const month = e.date.slice(0, 7);
        totals[month] = (totals[month] || 0) + Number(e.amount);
      });
      setChartTotals(totals);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreMonths() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const hardStop = new Date();
      hardStop.setFullYear(hardStop.getFullYear() - 3);
      const toStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      let accumulated: any[] = [];
      let cursor = new Date(oldestDate.current);
      let newOldest = oldestDate.current;
      let reachedEnd = false;

      while (accumulated.length === 0) {
        const chunkEnd = new Date(cursor);
        chunkEnd.setDate(chunkEnd.getDate() - 1);
        if (chunkEnd < hardStop) { reachedEnd = true; break; }

        const chunkStart = new Date(chunkEnd);
        chunkStart.setDate(chunkStart.getDate() - 29);
        const clampedStart = chunkStart < hardStop ? hardStop : chunkStart;

        const endStr = toStr(chunkEnd);
        const startStr = toStr(clampedStart);

        const { data: exp } = await supabase
          .from('expenses')
          .select('*, category:categories(*)')
          .eq('user_id', user.id)
          .gte('date', startStr)
          .lte('date', endStr)
          .order('date', { ascending: false });

        newOldest = startStr;
        cursor = clampedStart;

        if (exp && exp.length > 0) accumulated = exp;
        if (clampedStart <= hardStop) { reachedEnd = true; break; }
      }

      oldestDate.current = newOldest;
      if (accumulated.length > 0) setExpenses(prev => [...prev, ...accumulated]);
      if (reachedEnd) setHasMore(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadExtended() {
    if (extendedLoaded) return;
    try {
      const currentYear = new Date().getFullYear();
      const startDate = `${currentYear - 5}-01-01`;

      const [{ data: exp }, { data: yearExp }] = await Promise.all([
        supabase.from('expenses').select('*, category:categories(*)').eq('user_id', user.id).gte('date', startDate).order('date', { ascending: false }),
        supabase.from('expenses').select('date, amount').eq('user_id', user.id).gte('date', startDate),
      ]);

      setExpenses(exp as any || []);

      // Build year totals directly from DB data
      const totals: Record<number, number> = {};
      (yearExp || []).forEach((e: any) => {
        const yr = parseInt(e.date.slice(0, 4));
        totals[yr] = (totals[yr] || 0) + Number(e.amount);
      });
      setYearTotals(totals);
      setExtendedLoaded(true);
      setHasMore(false);
    } catch (err) {
      console.error(err);
    }
  }

  const loadData = useCallback(async () => {
    try {
      const now = new Date();
      const startStr = extendedLoaded ? `${now.getFullYear() - 5}-01-01` : oldestDate.current;
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const chartStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;

      const [{ data: exp }, { data: chartExp }] = await Promise.all([
        supabase.from('expenses').select('*, category:categories(*)').eq('user_id', user.id).gte('date', startStr).order('date', { ascending: false }),
        supabase.from('expenses').select('date, amount').eq('user_id', user.id).gte('date', chartStart),
      ]);

      setExpenses(exp || []);
      const totals: Record<string, number> = {};
      (chartExp || []).forEach((e: any) => {
        const month = e.date.slice(0, 7);
        totals[month] = (totals[month] || 0) + Number(e.amount);
      });
      setChartTotals(totals);
    } catch (err) {
      console.error(err);
    }
  }, [extendedLoaded, user.id]);

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    if (mode === 'years') loadExtended();
  }

  const now = new Date();
  // Stable keys for useMemo — won't change within the same month/year
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthRange = useMemo(() => getMonthRange(now), [currentMonth, currentYear]);
  const yearRange = useMemo(() => getYearRange(now), [currentYear]);

  const currentMonthExp = useMemo(
    () => expenses.filter(e => e.date >= monthRange.start && e.date <= monthRange.end),
    [expenses, monthRange.start, monthRange.end]
  );
  const currentYearExp = useMemo(
    () => expenses.filter(e => e.date >= yearRange.start && e.date <= yearRange.end),
    [expenses, yearRange.start, yearRange.end]
  );

  const accumulatedTotal = useMemo(
    () => viewMode === 'months'
      ? currentMonthExp.reduce((sum, e) => sum + Number(e.amount), 0)
      : currentYearExp.reduce((sum, e) => sum + Number(e.amount), 0),
    [viewMode, currentMonthExp, currentYearExp]
  );

  const chartData = useMemo(() => {
    if (viewMode === 'months') {
      const data: { name: string; year: string; total: number; isCurrent: boolean }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = format(d, 'yyyy-MM');
        const total = chartTotals[monthKey] || 0;
        data.push({ name: format(d, 'MMM', { locale: es }), year: format(d, 'yyyy'), total, isCurrent: i === 0 });
      }
      return data;
    } else {
      const data: { name: string; year: string; total: number; isCurrent: boolean }[] = [];
      for (let i = 5; i >= 0; i--) {
        const year = now.getFullYear() - i;
        const total = yearTotals[year] || expenses
          .filter(e => e.date >= `${year}-01-01` && e.date <= `${year}-12-31`)
          .reduce((sum, e) => sum + Number(e.amount), 0);
        data.push({ name: String(year), year: '', total, isCurrent: i === 0 });
      }
      return data;
    }
  }, [viewMode, chartTotals, yearTotals, expenses, currentMonth, currentYear]);

  const displayExpenses = viewMode === 'months' ? currentMonthExp : currentYearExp;

  const today = format(now, 'yyyy-MM-dd');
  const yesterday = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');

  const groupedByDay = useMemo(() => {
    const filtered = searchQuery
      ? displayExpenses.filter(e =>
          e.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ((e as any).category?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
      : displayExpenses;
    const dayMap = new Map<string, Expense[]>();
    filtered.forEach(exp => {
      if (!dayMap.has(exp.date)) dayMap.set(exp.date, []);
      dayMap.get(exp.date)!.push(exp);
    });
    return Array.from(dayMap.entries())
      .map(([dateStr, exps]) => ({
        date: dateStr,
        label: dateStr === today ? 'Hoy' : dateStr === yesterday ? 'Ayer' : format(parseISO(dateStr), "d 'de' MMMM", { locale: es }),
        total: exps.reduce((sum, e) => sum + Number(e.amount), 0),
        expenses: exps,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [displayExpenses, searchQuery, today, yesterday]);

  const openEdit = useCallback((expense: Expense) => {
    setEditingExpense({
      id: expense.id,
      amount: Number(expense.amount),
      description: expense.description,
      category_id: expense.category_id,
      date: expense.date,
    });
    setShowAddExpense(true);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (confirm('¿Eliminar este gasto?')) {
      await supabase.from('expenses').delete().eq('id', id);
      loadData();
    }
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto page-transition">
      {/* Top bar */}
      {showSearch ? (
        <div className="flex items-center gap-2 px-3 pt-4 pb-1">
          <div className="flex-1 relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar gastos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-dark-800 border border-dark-700 rounded-full py-1.5 pl-8 pr-3 text-xs placeholder:text-dark-500 focus:outline-none focus:border-dark-500 transition-colors"
            />
          </div>
          <button onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="p-1.5 text-dark-400">
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className="relative pt-5 pb-2 text-center">
          <button
            onClick={() => setShowSearch(true)}
            className="absolute top-4 right-3 p-1.5 text-dark-400 hover:text-dark-200 transition-colors"
          >
            <Search size={17} />
          </button>
          <p className="text-[1.6rem] font-extrabold tracking-tight leading-none">
            -{formatCurrency(accumulatedTotal)}
          </p>
          <p className="text-dark-400 text-[11px] mt-0.5 capitalize">
            {viewMode === 'months'
              ? format(now, 'MMMM yyyy', { locale: es })
              : now.getFullYear().toString()
            }
          </p>
        </div>
      )}

      {/* Toggle */}
      <div className="flex justify-center mb-2">
        <div className="inline-flex bg-dark-800 rounded-full p-0.5">
          <button
            onClick={() => handleViewModeChange('months')}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
              viewMode === 'months' ? 'bg-dark-600 text-white shadow-sm' : 'text-dark-400'
            }`}
          >
            Por meses
          </button>
          <button
            onClick={() => handleViewModeChange('years')}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
              viewMode === 'years' ? 'bg-dark-600 text-white shadow-sm' : 'text-dark-400'
            }`}
          >
            Por año
          </button>
        </div>
      </div>

      {/* Bar chart */}
      {!showSearch && (
        <div className="px-3 mb-0">
          <WalletChart data={chartData} />
        </div>
      )}

      {/* Spending Overview button */}
      {!showSearch && (
        <div className="px-3 py-1">
          <button
            onClick={() => onNavigate('overview')}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-dark-400 hover:text-dark-200 transition-colors"
          >
            <PieChart size={13} className="text-brand-400" />
            <span className="text-[11px] font-medium">Spending Overview</span>
            <ChevronRight size={12} className="text-dark-500" />
          </button>
        </div>
      )}

      {/* Search results */}
      {searchQuery && (
        <div className="px-3 py-1">
          <p className="text-[11px] text-dark-400">
            {groupedByDay.reduce((s, g) => s + g.expenses.length, 0)} resultado{groupedByDay.reduce((s, g) => s + g.expenses.length, 0) !== 1 && 's'} para &quot;{searchQuery}&quot;
          </p>
        </div>
      )}

      {/* Expenses by day */}
      <div className="min-h-[200px]">
        {groupedByDay.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="text-4xl mb-3">{searchQuery ? '🔍' : '🎯'}</div>
            <p className="text-dark-300 text-sm font-medium">
              {searchQuery ? 'No se encontraron gastos' : 'No hay gastos'}
            </p>
            {!searchQuery && (
              <p className="text-dark-500 text-xs mt-1">Tocá + para agregar tu primer gasto</p>
            )}
          </div>
        ) : (
          groupedByDay.map((group) => (
            <div key={group.date}>
              <div className="flex items-center justify-between px-3 py-1 bg-dark-800/60">
                <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wider capitalize">{group.label}</span>
                <span className="text-[10px] font-semibold text-dark-500">-{formatCurrency(group.total)}</span>
              </div>

              {group.expenses.map((expense) => (
                <SwipeableExpenseRow
                  key={expense.id}
                  expense={expense}
                  onEdit={() => openEdit(expense)}
                  onDelete={() => handleDelete(expense.id)}
                />
              ))}
            </div>
          ))
        )}

        {/* Infinite scroll sentinel */}
        {viewMode === 'months' && !searchQuery && (
          <div ref={sentinelRef} className="py-6 flex justify-center">
            {loadingMore && (
              <div className="w-5 h-5 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
            )}
            {!loadingMore && !hasMore && expenses.length > 0 && (
              <p className="text-[10px] text-dark-600">— Inicio del historial —</p>
            )}
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => { setEditingExpense(null); setShowAddExpense(true); }}
        className="fixed bottom-20 right-4 bg-brand-500 text-white w-12 h-12 rounded-full shadow-xl shadow-black/30 flex items-center justify-center z-40 active:scale-95 transition-transform"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>

      {/* Modal — lazy loaded */}
      {showAddExpense && (
        <Suspense fallback={null}>
          <AddExpenseModal
            user={user}
            defaultCurrency={defaultCurrency}
            onClose={() => { setShowAddExpense(false); setEditingExpense(null); }}
            onSaved={() => loadData()}
            editingExpense={editingExpense}
          />
        </Suspense>
      )}
    </div>
  );
}
