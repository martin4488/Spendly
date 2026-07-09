'use client';

import { useState, useEffect, useRef, lazy, Suspense, useCallback, useMemo } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import {
  format, parseISO,
  addMonths, subMonths, startOfMonth, endOfMonth,
  addYears, subYears, startOfYear, endOfYear,
  eachMonthOfInterval,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import CategoryIcon from '@/components/ui/CategoryIcon';
import { getCategories } from '@/lib/categoryCache';
import Amount from '@/components/ui/Amount';
import { CatNode, buildTree } from '@/lib/categoryTree';
import SwipeableRow from '@/components/SwipeableRow';
import { toast } from '@/lib/toast';
import { confirmDialog } from '@/lib/confirm';
import OfflineState from '@/components/ui/OfflineState';
const AddExpenseModal = lazy(() => import('@/components/AddExpenseModal'));

type ViewMode = 'months' | 'years';

interface RawCat { id: string; name: string; icon: string; color: string; parent_id: string | null; }

function allIds(node: CatNode): string[] {
  const out: string[] = [];
  function walk(n: CatNode) { out.push(n.id); for (const c of n.children) walk(c); }
  walk(node);
  return out;
}

interface CatSpend {
  id: string; name: string; icon: string; color: string;
  spent: number; percentage: number; transactions: number;
  children: CatSpend[];
  allIds: string[];
}

function buildSpend(node: CatNode, spendMap: Record<string, number>, txMap: Record<string, number>, total: number): CatSpend {
  const childSpends = node.children.map(c => buildSpend(c, spendMap, txMap, total));
  const directSpent = spendMap[node.id] || 0;
  const spent = directSpent + childSpends.reduce((s, c) => s + c.spent, 0);
  const transactions = (txMap[node.id] || 0) + childSpends.reduce((s, c) => s + c.transactions, 0);
  return {
    id: node.id, name: node.name, icon: node.icon, color: node.color, spent,
    percentage: total > 0 ? (spent / total) * 100 : 0,
    transactions,
    children: childSpends.sort((a, b) => b.spent - a.spent),
    allIds: allIds(node),
  };
}

interface DrillDown { id: string; name: string; icon: string; color: string; allIds: string[]; children: CatSpend[]; }
interface ExpenseDetail { id: string; date: string; description: string; amount: number; category_id?: string | null; }

// ── SVG Donut ──
function DonutChart({
  cats, total, selectedId, onSelectId,
}: {
  cats: CatSpend[]; total: number; selectedId: string | null; onSelectId: (id: string | null) => void;
}) {
  const CX = 150, CY = 140, R_OUTER = 100, R_INNER = 62;
  let cumAngle = -90;
  const slices = cats.map(cat => {
    const pct = total > 0 ? cat.spent / total : 0;
    const angle = pct * 360;
    const startA = cumAngle;
    cumAngle += angle;
    return { ...cat, pct, startA, endA: cumAngle };
  });
  function toRad(deg: number) { return (deg * Math.PI) / 180; }
  function polar(deg: number, r: number) { return { x: CX + r * Math.cos(toRad(deg)), y: CY + r * Math.sin(toRad(deg)) }; }
  function arc(s: number, e: number, ro: number, ri: number) {
    const p1 = polar(s, ro), p2 = polar(e, ro), p3 = polar(e, ri), p4 = polar(s, ri);
    const lg = e - s > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${ro} ${ro} 0 ${lg} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${ri} ${ri} 0 ${lg} 0 ${p4.x} ${p4.y} Z`;
  }
  const hasSelection = selectedId !== null;
  return (
    <svg viewBox="0 0 300 280" width="100%" height={260} style={{ display: 'block' }} onClick={() => onSelectId(null)}>
      {slices.map((s, i) => {
        if (s.pct < 0.008) return null;
        const GAP = s.pct < 0.03 ? 0.4 : 1.2;
        const isSelected = s.id === selectedId;
        const dimmed = hasSelection && !isSelected;
        const R_OUT = isSelected ? R_OUTER + 6 : R_OUTER;
        const R_IN = isSelected ? R_INNER - 3 : R_INNER;
        return (
          <path key={i} d={arc(s.startA + GAP / 2, s.endA - GAP / 2, R_OUT, R_IN)} fill={s.color}
            opacity={dimmed ? 0.2 : 1} style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
            onClick={(e) => { e.stopPropagation(); onSelectId(isSelected ? null : s.id); }} />
        );
      })}
      <text x={CX} y={CY - 10} textAnchor="middle" fill="white" fontSize={17} fontWeight={700}>{formatCurrency(total, undefined, true)}</text>
      <text x={CX} y={CY + 10} textAnchor="middle" fill="#64748b" fontSize={10} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>Gastos totales</text>
    </svg>
  );
}

// ── Bar Chart ──
interface BarSegment { amount: number; color: string; }
interface BarEntry { label: string; amount: number; monthKey: string; segments?: BarSegment[]; }

function DrillBarChart({
  data, color, selectedMonth, onSelectMonth,
}: {
  data: BarEntry[]; color: string; selectedMonth: string | null; onSelectMonth: (key: string | null) => void;
}) {
  const W = 320, H = 120, PAD_L = 36, PAD_B = 22, PAD_T = 8, PAD_R = 8;
  const chartW = W - PAD_L - PAD_R, chartH = H - PAD_B - PAD_T;
  const max = Math.max(...data.map(d => d.amount), 1);
  const yTicks = [0, max * 0.5, max];
  function fmtAmt(v: number) { if (v === 0) return '0'; if (v >= 1000) return `${(v / 1000).toFixed(1)}k`; return Math.round(v).toString(); }
  const barGap = chartW / data.length;
  const barW = Math.max(6, barGap * 0.72);
  const baseY = PAD_T + chartH;
  const hasSelection = selectedMonth !== null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}
      onClick={() => onSelectMonth(null)}>
      {yTicks.map((v, i) => {
        const y = PAD_T + chartH - (v / max) * chartH;
        return <g key={i}>
          <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#1e293b" strokeWidth={1} strokeDasharray="3,3" />
          <text x={PAD_L - 4} y={y} textAnchor="end" dominantBaseline="middle" fill="#475569" fontSize={8}>{fmtAmt(v)}</text>
        </g>;
      })}
      {data.map((d, i) => {
        const totalBarH = Math.max(2, (d.amount / max) * chartH);
        const x = PAD_L + i * barGap + barGap / 2 - barW / 2;
        const isSelected = d.monthKey === selectedMonth;
        const dimmed = hasSelection && !isSelected;
        const segs = d.segments && d.segments.length > 0 ? d.segments : [{ amount: d.amount, color: d.amount > 0 ? color : '#1e293b' }];
        const clipId = `dclip-${i}`;
        let stackY = baseY;
        return (
          <g key={i} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onSelectMonth(isSelected ? null : d.monthKey); }}>
            <defs>
              <clipPath id={clipId}>
                <rect x={x} y={baseY - totalBarH} width={barW} height={totalBarH} rx={2} ry={2} />
              </clipPath>
            </defs>
            {isSelected && (
              <rect x={x - 3} y={PAD_T} width={barW + 6} height={chartH} rx={3} fill="white" opacity={0.06} />
            )}
            {segs.map((seg, si) => {
              const segH = Math.max(0, (seg.amount / max) * chartH);
              stackY -= segH;
              return <rect key={si} x={x} y={stackY} width={barW}
                height={Math.max(segH, si === 0 && d.amount > 0 ? 2 : 0)}
                fill={seg.color} opacity={dimmed ? 0.3 : 1}
                clipPath={`url(#${clipId})`}
                style={{ transition: 'opacity 0.2s' }} />;
            })}
            <text x={PAD_L + i * barGap + barGap / 2} y={H - 6} textAnchor="middle"
              fill={isSelected ? '#e2e8f0' : '#475569'} fontSize={7.5} fontWeight={isSelected ? 700 : 400}>
              {d.label}
            </text>
          </g>
        );
      })}
      <line x1={PAD_L} y1={PAD_T + chartH} x2={W - PAD_R} y2={PAD_T + chartH} stroke="#1e293b" strokeWidth={1} />
    </svg>
  );
}

function SubcatSection({ expenses, drillDown, total }: {
  expenses: ExpenseDetail[]; drillDown: DrillDown; total: number;
}) {
  const subcatMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) { const cid = e.category_id || '__none'; map[cid] = (map[cid] || 0) + e.amount; }
    return map;
  }, [expenses]);

  const subs = useMemo(() => {
    if (drillDown.children.length === 0) return [];
    return drillDown.children
      .map(child => { const spent = child.allIds.reduce((s, id) => s + (subcatMap[id] || 0), 0); return { id: child.id, name: child.name, color: child.color, spent }; })
      .filter(c => c.spent > 0)
      .sort((a, b) => b.spent - a.spent);
  }, [drillDown.children, subcatMap]);

  if (subs.length === 0) return null;
  const subsTotal = subs.reduce((s, c) => s + c.spent, 0);

  return (
    <div className="px-4 pb-3 border-b border-dark-800/60">
      <p className="text-[10px] font-semibold text-dark-500 uppercase tracking-wider mb-2">Subcategorías</p>
      <div className="flex h-1.5 rounded-full overflow-hidden mb-3 gap-px">
        {subs.map(s => <div key={s.id} style={{ width: `${(s.spent / subsTotal) * 100}%`, background: s.color }} />)}
      </div>
      {subs.map(s => (
        <div key={s.id} className="flex items-center gap-2 py-1.5">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
          <span className="flex-1 text-[12px] text-dark-200 font-medium">{s.name}</span>
          <span className="text-[11px] text-dark-500 mr-2">{Math.round((s.spent / (total || 1)) * 100)}%</span>
          <span className="text-[12px] font-bold text-dark-100">{formatCurrency(s.spent, undefined, true)}</span>
        </div>
      ))}
    </div>
  );
}

function getRange(date: Date, mode: ViewMode) {
  if (mode === 'months') return { start: format(startOfMonth(date), 'yyyy-MM-dd'), end: format(endOfMonth(date), 'yyyy-MM-dd') };
  return { start: format(startOfYear(date), 'yyyy-MM-dd'), end: format(endOfYear(date), 'yyyy-MM-dd') };
}

// ── Main ──
export default function SpendingOverview({ user, onBack, initialDate, initialViewMode }: {
  user: User;
  onBack: () => void;
  initialDate?: Date;
  initialViewMode?: ViewMode;
}) {
  const now = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode || 'months');
  const [currentDate, setCurrentDate] = useState(initialDate || now);
  const [catSpending, setCatSpending] = useState<CatSpend[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const swipeStartX = useRef<number | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleSelectCat = useCallback((id: string | null) => {
    setSelectedCatId(id);
    if (id) {
      setTimeout(() => {
        const el = rowRefs.current[id];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  }, []);

  useEffect(() => { loadData(); }, [viewMode, currentDate]);
  useEffect(() => { setSelectedCatId(null); }, [viewMode, currentDate]);

  async function loadData() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setOffline(true); setLoading(false); return;
    }
    setOffline(false);
    setLoading(true);
    try {
      const range = getRange(currentDate, viewMode);
      const [{ data: rpcResult, error: rpcError }, catsMap] = await Promise.all([
        supabase.rpc('get_spending_overview', { p_user_id: user.id, p_start_date: range.start, p_end_date: range.end }),
        getCategories(user.id),
      ]);
      const allCats = Array.from(catsMap.values());
      const activeCats = allCats.filter((c: any) => c.deleted !== true);
      const tree = buildTree(activeCats);
      let total = 0;
      const spendMap: Record<string, number> = {};
      const txMap: Record<string, number> = {};
      if (!rpcError && rpcResult) {
        total = Number(rpcResult.total) || 0;
        for (const row of (rpcResult.category_totals || [])) {
          if (row.category_id) { spendMap[row.category_id] = Number(row.total); txMap[row.category_id] = Number(row.tx_count); }
        }
      } else {
        const { data: expenses, error: expErr } = await supabase.from('expenses').select('id, amount, category_id, description, date').eq('user_id', user.id).gte('date', range.start).lte('date', range.end).order('date', { ascending: false }).limit(10000);
        if (expErr) { setOffline(true); setLoading(false); return; }
        const allExp = expenses || [];
        for (const e of allExp as any[]) {
          total += Number(e.amount);
          if (e.category_id) {
            spendMap[e.category_id] = (spendMap[e.category_id] || 0) + Number(e.amount);
            txMap[e.category_id] = (txMap[e.category_id] || 0) + 1;
          }
        }
      }
      setTotalSpent(total);
      const spending: CatSpend[] = tree.map(node => buildSpend(node, spendMap, txMap, total)).filter(c => c.spent > 0).sort((a, b) => b.spent - a.spent);
      const allCatIds = new Set(activeCats.map((c: any) => c.id));
      let uncatSpent = 0, uncatTx = 0;
      for (const row of (rpcResult?.category_totals || []) as any[]) {
        if (!row.category_id || !allCatIds.has(row.category_id)) {
          uncatSpent += Number(row.total);
          uncatTx += Number(row.tx_count);
        }
      }
      if (uncatSpent > 0) spending.push({ id: 'uncategorized', name: 'Sin categoría', icon: 'package', color: '#95A5A6', spent: uncatSpent, percentage: total > 0 ? (uncatSpent / total) * 100 : 0, transactions: uncatTx, children: [], allIds: ['uncategorized'] });
      setCatSpending(spending);
    } catch (err) { console.error(err); setOffline(true); }
    finally { setLoading(false); }
  }

  function openDrillDown(cat: CatSpend) {
    setDrillDown({ id: cat.id, name: cat.name, icon: cat.icon, color: cat.color, allIds: cat.allIds, children: cat.children });
  }

  function navigate(dir: 1 | -1) {
    if (viewMode === 'months') { const n = dir === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1); if (n <= now) setCurrentDate(n); }
    else { const n = dir === 1 ? addYears(currentDate, 1) : subYears(currentDate, 1); if (n <= now) setCurrentDate(n); }
  }
  function onTouchStart(e: React.TouchEvent) { swipeStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null) return;
    const dx = swipeStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) navigate(dx > 0 ? 1 : -1);
    swipeStartX.current = null;
  }

  const periodLabel = viewMode === 'months' ? format(currentDate, 'MMMM yyyy', { locale: es }) : currentDate.getFullYear().toString();
  const prevLabel = viewMode === 'months' ? format(subMonths(currentDate, 1), 'MMM yyyy', { locale: es }) : String(currentDate.getFullYear() - 1);
  const isAtPresent = viewMode === 'months' ? format(currentDate, 'yyyy-MM') === format(now, 'yyyy-MM') : currentDate.getFullYear() === now.getFullYear();
  const nextLabel = isAtPresent ? '' : viewMode === 'months' ? format(addMonths(currentDate, 1), 'MMM yyyy', { locale: es }) : String(currentDate.getFullYear() + 1);

  if (drillDown) {
    const initialMonth = viewMode === 'months' ? format(currentDate, 'yyyy-MM') : null;
    return <DrillDownView user={user} drillDown={drillDown} onBack={() => setDrillDown(null)} initialDate={currentDate} initialMonth={initialMonth} now={now} />;
  }

  if (offline) return <OfflineState onRetry={loadData} onBack={onBack} />;

  function renderCatList(cats: CatSpend[], depth = 0): React.ReactNode {
    return cats.map(cat => {
      const activeChildren = cat.children.filter(c => c.spent > 0).sort((a, b) => b.spent - a.spent);
      const hasChildren = activeChildren.length > 0;
      const isExpanded = expanded.has(cat.id);
      const indent = depth * 16;
      const isSelected = selectedCatId === cat.id;
      const isDimmed = selectedCatId !== null && !isSelected;
      return (
        <div key={cat.id} ref={el => { rowRefs.current[cat.id] = el; }} className="border-b border-dark-800/40"
          style={{ opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.2s ease' }}>
          <div className="flex items-center gap-2.5 py-2.5" style={{ paddingLeft: `${12 + indent}px`, paddingRight: 12 }}>
            <button onClick={() => openDrillDown(cat)} className="flex-shrink-0 active:opacity-70">
              <CategoryIcon icon={cat.icon} color={cat.color} size={depth === 0 ? 36 : 28} rounded="xl" />
            </button>
            <button onClick={() => openDrillDown(cat)} className="flex-1 min-w-0 text-left active:opacity-70">
              <p className={`font-semibold ${depth === 0 ? 'text-[12px]' : 'text-[11px] text-dark-200'}`}>{cat.name}</p>
              <p className="text-[10px] text-dark-500">{cat.transactions} {cat.transactions === 1 ? 'transacción' : 'transacciones'}</p>
            </button>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={`text-dark-500 font-medium ${depth === 0 ? 'text-[11px]' : 'text-[10px]'}`}>{Math.round(cat.percentage)}%</span>
              <Amount value={cat.spent} size="sm" color="text-red-400" weight="bold" className={depth === 0 ? 'text-[12px]' : 'text-[11px]'} decimals={false} />
            </div>
            {hasChildren && (
              <button onClick={(e) => { e.stopPropagation(); setExpanded(prev => { const n = new Set(prev); n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id); return n; }); }} className="p-0.5 text-dark-500 ml-0.5">
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
          </div>
          {hasChildren && isExpanded && (
            <div className="border-l border-dark-700/40 ml-8">{renderCatList(activeChildren, depth + 1)}</div>
          )}
        </div>
      );
    });
  }

  return (
    <div className="max-w-lg mx-auto page-transition pb-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center gap-2 px-3 pt-4 pb-2">
        <button onClick={onBack} className="p-1 text-dark-300 hover:text-white transition-colors"><ArrowLeft size={20} /></button>
        <h1 className="text-sm font-bold flex-1 text-center pr-6">Overview</h1>
      </div>
      <div className="flex justify-center mb-2">
        <div className="inline-flex bg-dark-800 rounded-full p-0.5">
          <button onClick={() => { setViewMode('months'); setCurrentDate(initialDate || now); }} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'months' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>Por meses</button>
          <button onClick={() => { setViewMode('years'); setCurrentDate(initialDate || now); }} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'years' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>Por año</button>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 mb-1">
        <button onClick={() => navigate(-1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">← {prevLabel}</button>
        <p className="text-[13px] font-semibold capitalize">{periodLabel}</p>
        {isAtPresent ? <div className="w-20" /> : <button onClick={() => navigate(1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">{nextLabel} →</button>}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" /></div>
      ) : catSpending.length === 0 ? (
        <div className="text-center py-12"><div className="text-4xl mb-3">📊</div><p className="text-dark-300 text-sm">No hay datos para este período</p></div>
      ) : (
        <>
          <div className="px-2 mb-2">
            <DonutChart cats={catSpending} total={totalSpent} selectedId={selectedCatId} onSelectId={handleSelectCat} />
          </div>
          <div className="px-3">{renderCatList(catSpending)}</div>
        </>
      )}
    </div>
  );
}

// ── DrillDownView ──
function DrillDownView({ user, drillDown, onBack, initialDate, initialMonth, now }: {
  user: User; drillDown: DrillDown; onBack: () => void;
  initialDate: Date; initialMonth: string | null; now: Date;
}) {
  const currentYear = initialDate.getFullYear();
  const [year, setYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(initialMonth);
  const [allExpenses, setAllExpenses] = useState<ExpenseDetail[]>([]);
  const [barData, setBarData] = useState<BarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [allCats, setAllCats] = useState<RawCat[]>([]);
  // O(1) lookup map — replaces allCats.find() in render loop
  const [catsById, setCatsById] = useState<Map<string, RawCat>>(new Map());
  const swipeStartX = useRef<number | null>(null);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  const nowYear = now.getFullYear();
  const isAtPresent = year === nowYear;

  useEffect(() => { loadData(); }, [year]);

  async function loadData() {
    setLoading(true);
    try {
      const yearDate = new Date(year, 0, 1);
      const start = format(startOfYear(yearDate), 'yyyy-MM-dd');
      const end = format(endOfYear(yearDate), 'yyyy-MM-dd');
      const catsMap = await getCategories(user.id);
      const cats = Array.from(catsMap.values());
      setAllCats(cats);
      // Build id-indexed map once per load — used by the row render & buildBarData
      const map = new Map<string, RawCat>();
      for (const c of cats) map.set(c.id, c as any);
      setCatsById(map);

      let list: ExpenseDetail[] = [];
      if (drillDown.id === 'uncategorized') {
        const ids = new Set(cats.map((c: any) => c.id));
        const { data: exp } = await supabase.from('expenses').select('id, amount, description, date, category_id').eq('user_id', user.id).gte('date', start).lte('date', end).order('date', { ascending: false }).limit(10000);
        list = (exp || []).filter((e: any) => !e.category_id || !ids.has(e.category_id)).map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount), category_id: e.category_id }));
      } else {
        const { data: exp } = await supabase.from('expenses').select('id, amount, description, date, category_id').eq('user_id', user.id).in('category_id', drillDown.allIds).gte('date', start).lte('date', end).order('date', { ascending: false }).limit(10000);
        list = (exp || []).map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount), category_id: e.category_id }));
      }
      setAllExpenses(list);
      setBarData(buildBarData(list, year, map));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  // Single pass over expenses + Map color lookups (was: per-month .filter loop)
  function buildBarData(exp: ExpenseDetail[], yr: number, catMap: Map<string, RawCat>): BarEntry[] {
    const yearDate = new Date(yr, 0, 1);
    const months = eachMonthOfInterval({ start: startOfYear(yearDate), end: endOfYear(yearDate) });
    // Aggregate by month + category in a single pass
    const monthBuckets = new Map<string, { amount: number; bycat: Map<string, number> }>();
    for (const e of exp) {
      const mStr = e.date.slice(0, 7); // YYYY-MM
      let bucket = monthBuckets.get(mStr);
      if (!bucket) { bucket = { amount: 0, bycat: new Map() }; monthBuckets.set(mStr, bucket); }
      bucket.amount += e.amount;
      const cid = e.category_id || '__none';
      bucket.bycat.set(cid, (bucket.bycat.get(cid) || 0) + e.amount);
    }
    return months.map(m => {
      const mStr = format(m, 'yyyy-MM');
      const label = format(m, 'MMM', { locale: es });
      const bucket = monthBuckets.get(mStr);
      if (!bucket || bucket.amount === 0) return { label, amount: 0, monthKey: mStr, segments: [] };
      const segments: BarSegment[] = Array.from(bucket.bycat.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([cid, amt]) => ({ amount: amt, color: catMap.get(cid)?.color || drillDown.color }));
      return { label, amount: bucket.amount, monthKey: mStr, segments };
    });
  }

  const visibleExpenses = useMemo(() => {
    if (!selectedMonth) return allExpenses;
    return allExpenses.filter(e => e.date.startsWith(selectedMonth));
  }, [allExpenses, selectedMonth]);

  const yearTotal = useMemo(() => {
    let s = 0; for (const e of allExpenses) s += e.amount; return s;
  }, [allExpenses]);
  const closedMonths = useMemo(() => year < nowYear ? 12 : now.getMonth(), [year, nowYear, now]);
  const monthAvg = useMemo(() => {
    if (closedMonths === 0) return 0;
    const currentMonthStr = format(now, 'yyyy-MM');
    let closedTotal = 0;
    for (const e of allExpenses) if (!e.date.startsWith(currentMonthStr)) closedTotal += e.amount;
    return closedTotal / closedMonths;
  }, [allExpenses, closedMonths, now]);
  const selectedTotal = useMemo(() => {
    let s = 0; for (const e of visibleExpenses) s += e.amount; return s;
  }, [visibleExpenses]);
  const diffVsAvg = monthAvg > 0 ? ((selectedTotal - monthAvg) / monthAvg) * 100 : 0;

  const todayStr = format(now, 'yyyy-MM-dd');
  const yestStr = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');

  // Group by day in single pass — using map.get pattern
  const grouped = useMemo(() => {
    const dayMap = new Map<string, ExpenseDetail[]>();
    for (const e of visibleExpenses) {
      const arr = dayMap.get(e.date);
      if (arr) arr.push(e); else dayMap.set(e.date, [e]);
    }
    return Array.from(dayMap.entries())
      .map(([dateStr, exps]) => ({
        date: dateStr,
        label: dateStr === todayStr ? 'Hoy' : dateStr === yestStr ? 'Ayer' : format(parseISO(dateStr), 'd MMM', { locale: es }).toUpperCase(),
        total: exps.reduce((s, e) => s + e.amount, 0),
        expenses: exps,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [visibleExpenses, todayStr, yestStr]);

  // O(1) cat lookup — replaces allCats.find()
  function resolveCat(categoryId: string | null | undefined): RawCat | undefined {
    if (!categoryId) return undefined;
    return catsById.get(categoryId);
  }

  function openEdit(exp: ExpenseDetail) {
    setEditingExpense({ id: exp.id, amount: Number(exp.amount), description: exp.description, category_id: exp.category_id, date: exp.date });
    setShowExpenseModal(true);
  }

  async function deleteExpense(id: string) {
    if (!(await confirmDialog('¿Eliminar este gasto?'))) return;
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) { toast('No se pudo eliminar el gasto. Reintentá.'); return; }
    const updated = allExpenses.filter(e => e.id !== id);
    setAllExpenses(updated);
    setBarData(buildBarData(updated, year, catsById));
  }

  function onTouchStart(e: React.TouchEvent) { swipeStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null) return;
    const dx = swipeStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) {
      if (dx > 0 && !isAtPresent) setYear(y => y + 1);
      else if (dx < 0) setYear(y => y - 1);
    }
    swipeStartX.current = null;
  }

  const selectedMonthLabel = selectedMonth ? format(parseISO(selectedMonth + '-01'), 'MMMM yyyy', { locale: es }) : null;

  return (
    <div className="max-w-lg mx-auto page-transition pb-8" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <button onClick={onBack} className="p-1 text-dark-300 hover:text-white transition-colors"><ArrowLeft size={20} /></button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <CategoryIcon icon={drillDown.icon} color={drillDown.color} size={32} rounded="xl" />
          <h1 className="text-sm font-bold truncate capitalize">{drillDown.name}</h1>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 mb-2">
        <button onClick={() => setYear(y => y - 1)} className="text-[11px] text-dark-500 py-1 px-2 active:text-dark-300">← {year - 1}</button>
        <p className="text-[13px] font-semibold">{year}</p>
        {isAtPresent ? <div className="w-16" /> : <button onClick={() => setYear(y => y + 1)} className="text-[11px] text-dark-500 py-1 px-2 active:text-dark-300">{year + 1} →</button>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="px-3 mb-1">
            <DrillBarChart data={barData} color={drillDown.color} selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} />
          </div>

          <div className="flex items-stretch border-t border-b border-dark-800/60 mb-1">
            {selectedMonth ? (
              <>
                <div className="flex-1 px-4 py-3">
                  <p className="text-[9px] font-semibold text-dark-500 uppercase tracking-wider mb-0.5">Total {selectedMonthLabel}</p>
                  <p className="text-[15px] font-bold text-red-400">{formatCurrency(selectedTotal, undefined, true)}</p>
                </div>
                <div className="w-px bg-dark-800/60" />
                <div className="flex-1 px-4 py-3">
                  <p className="text-[9px] font-semibold text-dark-500 uppercase tracking-wider mb-0.5">vs prom mensual</p>
                  <p className={`text-[15px] font-bold ${diffVsAvg > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {diffVsAvg > 0 ? '+' : ''}{Math.round(diffVsAvg)}%
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 px-4 py-3">
                  <p className="text-[9px] font-semibold text-dark-500 uppercase tracking-wider mb-0.5">Total {year}</p>
                  <p className="text-[15px] font-bold text-red-400">{formatCurrency(yearTotal, undefined, true)}</p>
                </div>
                <div className="w-px bg-dark-800/60" />
                <div className="flex-1 px-4 py-3">
                  <p className="text-[9px] font-semibold text-dark-500 uppercase tracking-wider mb-0.5">Prom / mes</p>
                  <p className="text-[15px] font-bold text-dark-100">{formatCurrency(monthAvg, undefined, true)}</p>
                </div>
              </>
            )}
          </div>

          <SubcatSection expenses={visibleExpenses} drillDown={drillDown} total={selectedMonth ? selectedTotal : yearTotal} />

          {grouped.length === 0 ? (
            <div className="text-center py-10"><p className="text-dark-500 text-sm">Sin transacciones</p></div>
          ) : (
            <div>
              <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                <p className="text-sm font-bold">Transacciones</p>
                <span className="text-[11px] text-dark-500">· {visibleExpenses.length}</span>
              </div>
              {grouped.map(group => (
                <div key={group.date}>
                  <div className="flex items-center justify-between px-4 py-1.5 bg-dark-800/60">
                    <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wider">{group.label}</span>
                    <Amount value={group.total} size="sm" weight="semibold" color="text-dark-500" className="text-[10px]" decimals={false} />
                  </div>
                  {group.expenses.map(exp => {
                    const cat = resolveCat(exp.category_id);
                    const displayIcon = cat?.icon || drillDown.icon;
                    const displayColor = cat?.color || drillDown.color;
                    const displayName = cat?.name || drillDown.name;
                    return (
                      <SwipeableRow key={exp.id} onDelete={() => deleteExpense(exp.id)}>
                        <div onClick={() => openEdit(exp)} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-dark-800/40 bg-dark-900 active:bg-dark-700/40 cursor-pointer transition-colors">
                          <CategoryIcon icon={displayIcon} color={displayColor} size={32} rounded="xl" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold truncate">{displayName}</p>
                            {exp.description && exp.description !== displayName && (
                              <p className="text-[10px] text-dark-500 truncate">{exp.description}</p>
                            )}
                          </div>
                          <Amount value={exp.amount} size="sm" color="text-red-400" weight="bold" className="flex-shrink-0" decimals={false} />
                        </div>
                      </SwipeableRow>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showExpenseModal && (
        <Suspense fallback={null}>
          <AddExpenseModal
            user={user}
            defaultCurrency={'EUR' as any}
            onClose={() => { setShowExpenseModal(false); setEditingExpense(null); }}
            onSaved={() => { setShowExpenseModal(false); setEditingExpense(null); loadData(); }}
            editingExpense={editingExpense}
          />
        </Suspense>
      )}
    </div>
  );
}
