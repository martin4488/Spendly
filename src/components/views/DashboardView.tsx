'use client';

import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense, memo } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { getYearRange } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Expense, Category } from '@/types';
import { Plus, Search, X } from 'lucide-react';
import CategoryIcon from '@/components/ui/CategoryIcon';
import type { CurrencyCode } from '@/lib/currency';
import { getCategories } from '@/lib/categoryCache';
import SwipeableRow from '@/components/SwipeableRow';
import { readDashboardCache, writeDashboardCache, buildCategoriesMapFromCache } from '@/lib/dashboardCache';
import Amount from '@/components/ui/Amount';

const AddExpenseModal = lazy(() => import('@/components/AddExpenseModal'));

type ViewMode = 'months' | 'years';

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MONTHS_SHORT_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse 'yyyy-MM-dd' into day/month label without date-fns */
function formatDayLabel(dateStr: string, todayStr: string, yesterdayStr: string): string {
  if (dateStr === todayStr) return 'Hoy';
  if (dateStr === yesterdayStr) return 'Ayer';
  const [, m, d] = dateStr.split('-');
  const month = MONTHS_ES[parseInt(m, 10) - 1];
  return `${parseInt(d, 10)} de ${month}`;
}

// ── Custom chart ──────────────────────────────────────────────────────────────
function WalletChart({
  data,
}: {
  data: { name: string; year: string; total: number; isCurrent: boolean }[];
}) {
  const W = 340;
  const H = 130;
  const padL = 36;
  const padR = 4;
  const padTop = 24;
  const padBottom = 32;
  const plotH = H - padTop - padBottom;
  const plotW = W - padL - padR;

  const maxVal = Math.max(...data.map(d => d.total), 1);
  const topVal = maxVal * 1.15; // 15% headroom
  const midVal = topVal / 2;

  const fmtGrid = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1).replace('.0', '')}k` : `${Math.round(v)}`;

  const toY = (v: number) => padTop + plotH - (v / topVal) * plotH;
  const baseY = toY(0);
  const midY = toY(midVal);
  const topY = toY(topVal);

  const n = data.length;
  const slotW = plotW / n;
  const barW = slotW * 0.45;

  const gridlines = [
    { y: topY, label: fmtGrid(topVal) },
    { y: midY, label: fmtGrid(midVal) },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {/* Dynamic gridlines */}
      {gridlines.map((g, i) => (
        <g key={i}>
          <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 3" strokeWidth={1} />
          <text x={padL - 4} y={g.y + 3} textAnchor="end" fill="#71717a" fontSize={9} fontFamily="var(--font-mono)">{g.label}</text>
        </g>
      ))}
      {/* Baseline */}
      <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} />
      <text x={padL - 4} y={baseY + 3} textAnchor="end" fill="#71717a" fontSize={9} fontFamily="var(--font-mono)">0</text>

      {data.map((entry, i) => {
        const cx = padL + i * slotW + slotW / 2;
        const barH = Math.max((entry.total / topVal) * plotH, entry.total > 0 ? 2 : 0);
        const barX = cx - barW / 2;
        const barY = baseY - barH;
        return (
          <g key={i}>
            <title>{entry.name} {entry.year}: {Math.round(entry.total)}</title>
            <rect x={barX} y={barY} width={barW} height={barH} rx={3}
              fill={entry.isCurrent ? '#f87171' : 'rgba(248,113,113,0.32)'} />
            <text x={cx} y={baseY + 13} textAnchor="middle"
              fill={entry.isCurrent ? '#e4e4e7' : '#a1a1aa'} fontSize={10}
              fontWeight={entry.isCurrent ? 700 : 500}>
              {entry.name}
            </text>
            {entry.year && (
              <text x={cx} y={baseY + 24} textAnchor="middle" fill="#71717a" fontSize={9} fontFamily="var(--font-mono)">
                {entry.year}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Memoized expense row ───────────────────────────────────────────────────
const ExpenseRow = memo(function ExpenseRow({
  expense,
  categoriesMap,
  defaultCurrency,
  onEdit,
  onDelete,
}: {
  expense: Expense;
  categoriesMap: Map<string, Category>;
  defaultCurrency: CurrencyCode;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const cat = expense.category_id ? categoriesMap.get(expense.category_id) : null;
  const parentCat = cat?.parent_id ? categoriesMap.get(cat.parent_id) : null;

  const primaryLabel = parentCat ? parentCat.name : (cat?.name || 'Sin categoría');
  const subLabel = parentCat ? cat?.name : null;

  const catDisplayName = subLabel || cat?.name || '';
  const showDescription = !!expense.description && expense.description !== catDisplayName;

  return (
    <SwipeableRow onTap={onEdit} onDelete={onDelete} className="border-b border-dark-800/40">
      <div className="flex items-center gap-2.5 px-3 py-2 bg-dark-900 active:bg-dark-800/60 transition-colors cursor-pointer select-none">
        <CategoryIcon icon={cat?.icon || 'banknote'} color={cat?.color ?? '#475569'} size={36} rounded="xl" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold truncate leading-tight">
            {primaryLabel}
            {subLabel && (
              <span className="text-dark-400 font-normal"> · {subLabel}</span>
            )}
            {expense.is_recurring && ' 🔄'}
          </p>
          {showDescription && (
            <p className="text-[10px] text-dark-500 mt-0.5 leading-tight truncate">{expense.description}</p>
          )}
        </div>
        <Amount value={Number(expense.amount)} currency={defaultCurrency} size="sm" color="text-red-400" weight="bold" className="flex-shrink-0" />
      </div>
    </SwipeableRow>
  );
});

// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardView({ user, onNavigate, defaultCurrency }: { user: User; onNavigate: (tab: any) => void; defaultCurrency: CurrencyCode }) {
  // ── Instant init from cache ─────────────────────────────────────────────
  const cached = useMemo(() => readDashboardCache(user.id), [user.id]);
  const hasCachedData = !!cached;

  const [expenses, setExpenses] = useState<Expense[]>(cached?.expenses || []);
  const [categoriesMap, setCategoriesMap] = useState<Map<string, Category>>(
    cached ? buildCategoriesMapFromCache(cached.categories) : new Map()
  );
  // Skip loading spinner if we have cached data to show
  const [loading, setLoading] = useState(!hasCachedData);
  const [chartTotals, setChartTotals] = useState<Record<string, number>>(cached?.chartTotals || {});
  const [yearTotals, setYearTotals] = useState<Record<number, number>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('months');
  const [extendedLoaded, setExtendedLoaded] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Stable date values — recalculated only on re-mount, not every render
  const currentMonth = useMemo(() => new Date().getMonth(), []);
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  useEffect(() => { loadDashboard(); }, []);

  useEffect(() => {
    if (showSearch && searchRef.current) searchRef.current.focus();
  }, [showSearch]);

  // ── Unified load: used both on mount and after save/delete ────────────────
  const loadDashboard = useCallback(async () => {
    try {
      const now = new Date();
      const start31 = new Date(now);
      start31.setDate(start31.getDate() - 30); // 31 days inclusive
      const startStr = toDateStr(start31);

      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const chartStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;

      const [{ data: rpcResult, error: rpcError }, map] = await Promise.all([
        supabase.rpc('get_dashboard_data', {
          p_user_id: user.id,
          p_recent_start: startStr,
          p_chart_start: chartStart,
        }),
        getCategories(user.id),
      ]);

      let freshExpenses: Expense[] = [];
      let freshTotals: Record<string, number> = {};

      if (rpcError || !rpcResult) {
        // Fallback: 2-query approach
        const [{ data: exp }, { data: chartExp }] = await Promise.all([
          supabase.from('expenses').select('*').eq('user_id', user.id).gte('date', startStr).order('date', { ascending: false }).limit(500),
          supabase.from('expenses').select('date, amount').eq('user_id', user.id).gte('date', chartStart).limit(10000),
        ]);
        freshExpenses = exp || [];
        (chartExp || []).forEach((e: any) => {
          const month = e.date.slice(0, 7);
          freshTotals[month] = (freshTotals[month] || 0) + Number(e.amount);
        });
      } else {
        freshExpenses = rpcResult.recent_expenses || [];
        (rpcResult.monthly_totals || []).forEach((row: { month: string; total: number }) => {
          freshTotals[row.month] = Number(row.total);
        });
      }

      setExpenses(freshExpenses);
      setChartTotals(freshTotals);
      setCategoriesMap(map);

      // Persist to cache for next cold start
      writeDashboardCache(user.id, freshExpenses, freshTotals, map);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  async function loadExtended() {
    try {
      const yr = currentYear;
      const yearStart = `${yr}-01-01`;
      const yearEnd = `${yr}-12-31`;

      const [{ data: rpcData }, { data: currentYearExpData }] = await Promise.all([
        supabase.rpc('get_yearly_totals', {
          p_user_id: user.id,
          p_start_year: yr - 5,
          p_end_year: yr,
        }),
        supabase
          .from('expenses')
          .select('*')
          .eq('user_id', user.id)
          .gte('date', yearStart)
          .lte('date', yearEnd)
          .order('date', { ascending: false }),
      ]);

      const totals: Record<number, number> = {};
      (rpcData || []).forEach((row: { year: number; total: number }) => {
        totals[row.year] = Number(row.total);
      });
      setYearTotals(totals);
      setExpenses(currentYearExpData || []);
      setExtendedLoaded(true);
    } catch (err) {
      console.error(err);
    }
  }

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    if (mode === 'years') {
      loadExtended();
    } else if (extendedLoaded) {
      // Switching back to months — reload 31-day window
      setExtendedLoaded(false);
      loadDashboard();
    }
  }

  const yearRange = useMemo(() => getYearRange(new Date(currentYear, currentMonth, 1)), [currentYear]);

  const currentYearExp = useMemo(
    () => expenses.filter(e => e.date >= yearRange.start && e.date <= yearRange.end),
    [expenses, yearRange.start, yearRange.end]
  );

  // Months mode: show all loaded expenses (already 31 days from query)
  // Years mode: filter to current year
  const displayExpenses = viewMode === 'months' ? expenses : currentYearExp;

  // Header total: always from chartTotals for current month (months mode) or yearTotals (years mode)
  const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const accumulatedTotal = useMemo(() => {
    if (viewMode === 'months') {
      return chartTotals[monthKey] || 0;
    }
    return yearTotals[currentYear] || 0;
  }, [viewMode, chartTotals, yearTotals, monthKey, currentYear]);

  const chartData = useMemo(() => {
    if (viewMode === 'months') {
      const data: { name: string; year: string; total: number; isCurrent: boolean }[] = [];
      for (let i = 5; i >= 0; i--) {
        const m = currentMonth - i;
        const y = currentYear + Math.floor(m / 12);
        const mo = ((m % 12) + 12) % 12;
        const key = `${y}-${String(mo + 1).padStart(2, '0')}`;
        const total = chartTotals[key] || 0;
        data.push({
          name: MONTHS_SHORT_ES[mo],
          year: String(y),
          total,
          isCurrent: i === 0,
        });
      }
      return data;
    } else {
      const data: { name: string; year: string; total: number; isCurrent: boolean }[] = [];
      for (let i = 5; i >= 0; i--) {
        const year = currentYear - i;
        const total = yearTotals[year] || 0;
        data.push({ name: String(year), year: '', total, isCurrent: i === 0 });
      }
      return data;
    }
  }, [viewMode, chartTotals, yearTotals, currentMonth, currentYear]);

  const todayStr = useMemo(() => toDateStr(new Date()), []);
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toDateStr(d);
  }, []);

  const groupedByDay = useMemo(() => {
    const filtered = searchQuery
      ? displayExpenses.filter(e => {
          const cat = e.category_id ? categoriesMap.get(e.category_id) : null;
          const parentCat = cat?.parent_id ? categoriesMap.get(cat.parent_id) : null;
          const q = searchQuery.toLowerCase();
          return (
            (e.description || '').toLowerCase().includes(q) ||
            (cat?.name || '').toLowerCase().includes(q) ||
            (parentCat?.name || '').toLowerCase().includes(q)
          );
        })
      : displayExpenses;

    const dayMap = new Map<string, Expense[]>();
    filtered.forEach(exp => {
      if (!dayMap.has(exp.date)) dayMap.set(exp.date, []);
      dayMap.get(exp.date)!.push(exp);
    });

    return Array.from(dayMap.entries())
      .map(([dateStr, exps]) => ({
        date: dateStr,
        label: formatDayLabel(dateStr, todayStr, yesterdayStr),
        total: exps.reduce((sum, e) => sum + Number(e.amount), 0),
        expenses: exps,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [displayExpenses, searchQuery, todayStr, yesterdayStr, categoriesMap]);

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
      loadDashboard();
    }
  }, [loadDashboard]);

  // Header subtitle
  const headerSubtitle = viewMode === 'months'
    ? `${MONTHS_ES[currentMonth]} ${currentYear}`
    : String(currentYear);

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
          <div className="leading-none" style={{ fontSize: 34 }}>
            <Amount value={accumulatedTotal} currency={defaultCurrency} size="xl" weight="extrabold" className="!text-[34px] !tracking-[-1.5px]" />
          </div>
          <p className="text-dark-400 text-[11px] mt-1.5 capitalize font-medium">
            {headerSubtitle}
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
        <div className="px-5 pt-1.5 pb-3.5 flex justify-center">
          <button
            onClick={() => onNavigate('overview')}
            aria-label="Ver detalle de gastos del mes"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-dark-800 rounded-full text-dark-300 hover:text-dark-200 transition-colors"
          >
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0"
              style={{
                background: 'conic-gradient(#22c55e 0 65%, rgba(255,255,255,0.08) 65% 100%)',
              }}
            />
            <span className="text-[11px] font-semibold">Spending Overview</span>
            <span className="text-dark-500 text-[13px] leading-none">›</span>
          </button>
        </div>
      )}

      {/* Search results count */}
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
                <Amount value={group.total} currency={defaultCurrency} size="sm" weight="semibold" color="text-dark-500" className="text-[10px]" />
              </div>

              {group.expenses.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  categoriesMap={categoriesMap}
                  defaultCurrency={defaultCurrency}
                  onEdit={() => openEdit(expense)}
                  onDelete={() => handleDelete(expense.id)}
                />
              ))}
            </div>
          ))
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
            onSaved={() => loadDashboard()}
            editingExpense={editingExpense}
          />
        </Suspense>
      )}
    </div>
  );
}
