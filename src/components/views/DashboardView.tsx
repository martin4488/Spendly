'use client';

import { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, getYearRange } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Expense, Category } from '@/types';
import { Plus, Trash2, ChevronRight, PieChart, Search, X } from 'lucide-react';
import AddExpenseModal from '@/components/AddExpenseModal';
import type { CurrencyCode } from '@/lib/currency';

type ViewMode = 'months' | 'years';

function formatCompact(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

// ── Custom chart matching Wallet iOS style ────────────────────────────────────
function WalletChart({
  data,
  formatValue,
}: {
  data: { name: string; year: string; total: number; isCurrent: boolean }[];
  formatValue: (v: number) => string;
}) {
  const W = 340; // viewBox width
  const H = 130; // viewBox height
  const padL = 4;
  const padR = 4;
  const padTop = 24; // space for top label
  const padBottom = 32; // space for x-axis labels
  const plotH = H - padTop - padBottom;
  const plotW = W - padL - padR;

  const maxVal = Math.max(...data.map(d => d.total), 1);
  const midVal = maxVal / 2;
  const topVal = maxVal * 1.05; // slight headroom

  const toY = (v: number) => padTop + plotH - (v / topVal) * plotH;
  const baseY = toY(0);
  const midY = toY(midVal);
  const topY = toY(topVal);

  const n = data.length;
  const slotW = plotW / n;
  const barW = slotW * 0.28; // thin bars like Wallet

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {/* Top dashed line + label */}
      <line x1={padL} y1={topY} x2={W - padR} y2={topY} stroke="#2d3f55" strokeDasharray="3 3" strokeWidth={1} />
      <text x={padL + 2} y={topY - 3} fill="#64748b" fontSize={10}>{formatCompact(topVal)}</text>

      {/* Mid dashed line + label */}
      <line x1={padL} y1={midY} x2={W - padR} y2={midY} stroke="#2d3f55" strokeDasharray="3 3" strokeWidth={1} />
      <text x={padL + 2} y={midY - 3} fill="#64748b" fontSize={10}>{formatCompact(midVal)}</text>

      {/* Zero dashed line + label */}
      <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="#2d3f55" strokeDasharray="3 3" strokeWidth={1} />
      <text x={padL + 2} y={baseY - 3} fill="#64748b" fontSize={10}>0</text>

      {/* Solid baseline */}
      <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="#3d5068" strokeWidth={1.5} />

      {/* Bars + x labels */}
      {data.map((entry, i) => {
        const cx = padL + i * slotW + slotW / 2;
        const barH = Math.max((entry.total / topVal) * plotH, entry.total > 0 ? 2 : 0);
        const barX = cx - barW / 2;
        const barY = baseY - barH;
        return (
          <g key={i}>
            {/* Bar */}
            <rect
              x={barX}
              y={barY}
              width={barW}
              height={barH}
              rx={2}
              fill={entry.isCurrent ? '#ef4444' : 'rgba(239,68,68,0.18)'}
            />
            {/* Month label */}
            <text
              x={cx}
              y={baseY + 13}
              textAnchor="middle"
              fill={entry.isCurrent ? '#94a3b8' : '#64748b'}
              fontSize={11}
              fontWeight={entry.isCurrent ? 600 : 400}
            >
              {entry.name}
            </text>
            {/* Year label (only for months mode) */}
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

// ─── Swipeable expense row ────────────────────────────────────────────────────
function SwipeableExpenseRow({
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
  const DELETE_THRESHOLD = 72; // px – how far you need to swipe to reveal the button
  const SNAP_THRESHOLD = 36;   // px – snap open if you've swiped past this

  const cat = (expense as any).category;

  // ── touch handlers ──────────────────────────────────────────────────────────
  function onTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0].clientX;
    setIsDragging(false);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startXRef.current === null) return;
    const dx = startXRef.current - e.touches[0].clientX; // positive = swipe left
    if (dx > 5) setIsDragging(true);
    if (dx > 0) {
      currentXRef.current = Math.min(dx, DELETE_THRESHOLD);
      setOffset(currentXRef.current);
    } else if (dx < 0 && offset > 0) {
      // swiping back right
      currentXRef.current = Math.max(0, offset + dx);
      setOffset(currentXRef.current);
    }
  }

  function onTouchEnd() {
    if (currentXRef.current > SNAP_THRESHOLD) {
      setOffset(DELETE_THRESHOLD); // snap open
    } else {
      setOffset(0); // snap closed
    }
    startXRef.current = null;
  }

  function handleRowClick() {
    if (isDragging) return; // ignore tap if we were swiping
    if (offset > 0) {
      setOffset(0); // close swipe on tap
    } else {
      onEdit();
    }
  }

  return (
    <div className="relative overflow-hidden border-b border-dark-800/40">
      {/* Red delete button revealed underneath */}
      <div
        className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500"
        style={{ width: DELETE_THRESHOLD }}
      >
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="flex flex-col items-center justify-center w-full h-full gap-1 active:bg-red-600 transition-colors"
        >
          <Trash2 size={18} className="text-white" />
          <span className="text-[10px] text-white font-medium">Borrar</span>
        </button>
      </div>

      {/* Foreground row */}
      <div
        className="flex items-center gap-2.5 px-3 py-2 bg-dark-900 active:bg-dark-800/60 transition-colors cursor-pointer select-none"
        style={{
          transform: `translateX(-${offset}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleRowClick}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
          style={{ backgroundColor: cat?.color ?? '#475569' }}
        >
          {cat?.icon || '💵'}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold truncate leading-tight">{expense.description}</p>
          <p className="text-[10px] text-dark-500 mt-0.5 leading-tight">
            {cat?.name || 'Sin categoría'}
            {expense.is_recurring && ' · 🔄'}
          </p>
        </div>

        <span className="text-[12px] font-bold text-red-400 flex-shrink-0">
          -{formatCurrency(Number(expense.amount))}
        </span>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardView({ user, onNavigate, defaultCurrency }: { user: User; onNavigate: (tab: any) => void; defaultCurrency: CurrencyCode }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('months');
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (showSearch && searchRef.current) {
      searchRef.current.focus();
    }
  }, [showSearch]);

  async function loadData() {
    try {
      const startDate = `${new Date().getFullYear() - 2}-01-01`;
      const { data: exp } = await supabase
        .from('expenses')
        .select('*, category:categories(*)')
        .eq('user_id', user.id)
        .gte('date', startDate)
        .order('date', { ascending: false });
      setExpenses(exp || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const now = new Date();
  const monthRange = getMonthRange(now);
  const yearRange = getYearRange(now);

  const currentMonthExp = expenses.filter(e => e.date >= monthRange.start && e.date <= monthRange.end);
  const currentYearExp = expenses.filter(e => e.date >= yearRange.start && e.date <= yearRange.end);

  const accumulatedTotal = viewMode === 'months'
    ? currentMonthExp.reduce((sum, e) => sum + Number(e.amount), 0)
    : currentYearExp.reduce((sum, e) => sum + Number(e.amount), 0);

  const chartData = viewMode === 'months'
    ? (() => {
        const data: { name: string; year: string; total: number; isCurrent: boolean }[] = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const range = getMonthRange(d);
          const total = expenses
            .filter(e => e.date >= range.start && e.date <= range.end)
            .reduce((sum, e) => sum + Number(e.amount), 0);
          data.push({ name: format(d, 'MMM', { locale: es }), year: format(d, 'yyyy'), total, isCurrent: i === 0 });
        }
        return data;
      })()
    : (() => {
        const data: { name: string; year: string; total: number; isCurrent: boolean }[] = [];
        for (let i = 2; i >= 0; i--) {
          const year = now.getFullYear() - i;
          const start = `${year}-01-01`;
          const end = `${year}-12-31`;
          const total = expenses
            .filter(e => e.date >= start && e.date <= end)
            .reduce((sum, e) => sum + Number(e.amount), 0);
          data.push({ name: String(year), year: '', total, isCurrent: i === 0 });
        }
        return data;
      })();

  const displayExpenses = viewMode === 'months' ? currentMonthExp : currentYearExp;
  const filteredExpenses = searchQuery
    ? displayExpenses.filter(e =>
        e.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ((e as any).category?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : displayExpenses;

  const dayMap = new Map<string, Expense[]>();
  filteredExpenses.forEach(exp => {
    if (!dayMap.has(exp.date)) dayMap.set(exp.date, []);
    dayMap.get(exp.date)!.push(exp);
  });

  const today = format(now, 'yyyy-MM-dd');
  const yesterday = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');

  const groupedByDay = Array.from(dayMap.entries())
    .map(([dateStr, exps]) => ({
      date: dateStr,
      label: dateStr === today ? 'Hoy' : dateStr === yesterday ? 'Ayer' : format(parseISO(dateStr), "d 'de' MMMM", { locale: es }),
      total: exps.reduce((sum, e) => sum + Number(e.amount), 0),
      expenses: exps,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  function openEdit(expense: Expense) {
    setEditingExpense({
      id: expense.id,
      amount: Number(expense.amount),
      description: expense.description,
      category_id: expense.category_id,
      date: expense.date,
    });
    setShowAddExpense(true);
  }

  async function handleDelete(id: string) {
    if (confirm('¿Eliminar este gasto?')) {
      await supabase.from('expenses').delete().eq('id', id);
      loadData();
    }
  }

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
            onClick={() => setViewMode('months')}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
              viewMode === 'months' ? 'bg-dark-600 text-white shadow-sm' : 'text-dark-400'
            }`}
          >
            Por meses
          </button>
          <button
            onClick={() => setViewMode('years')}
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
          <WalletChart data={chartData} formatValue={formatCurrency} />
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
            {filteredExpenses.length} resultado{filteredExpenses.length !== 1 && 's'} para &quot;{searchQuery}&quot;
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
      </div>

      {/* FAB */}
      <button
        onClick={() => { setEditingExpense(null); setShowAddExpense(true); }}
        className="fixed bottom-20 right-4 bg-brand-500 text-white w-12 h-12 rounded-full shadow-xl shadow-black/30 flex items-center justify-center z-40 active:scale-95 transition-transform"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>

      {/* Modal */}
      {showAddExpense && (
        <AddExpenseModal
          user={user}
          defaultCurrency={defaultCurrency}
          onClose={() => { setShowAddExpense(false); setEditingExpense(null); }}
          onSaved={() => loadData()}
          editingExpense={editingExpense}
        />
      )}
    </div>
  );
}
