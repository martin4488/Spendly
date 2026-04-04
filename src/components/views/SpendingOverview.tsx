'use client';

import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import {
  format, parseISO,
  addMonths, subMonths, startOfMonth, endOfMonth,
  addYears, subYears, startOfYear, endOfYear,
  eachDayOfInterval, eachMonthOfInterval,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowLeft, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { getCategories } from '@/lib/categoryCache';
import { CatNode, buildTree } from '@/lib/categoryTree';
import SwipeableRow from '@/components/SwipeableRow';
import type { Category } from '@/types';
const AddExpenseModal = lazy(() => import('@/components/AddExpenseModal'));

type ViewMode = 'months' | 'years';

interface RawCat { id: string; name: string; icon: string; color: string; parent_id: string | null; }

// Collect all descendant ids including self
function allIds(node: CatNode): string[] {
  return [node.id, ...node.children.flatMap(allIds)];
}

// ── CatSpend (flattened for donut) ────────────────────────────────────────────
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
  return { id: node.id, name: node.name, icon: node.icon, color: node.color, spent, percentage: total > 0 ? (spent / total) * 100 : 0, transactions, children: childSpends, allIds: allIds(node) };
}

// ── DrillDown ─────────────────────────────────────────────────────────────────
interface DrillDown { id: string; name: string; icon: string; color: string; allIds: string[]; children: CatSpend[]; }

interface ExpenseDetail { id: string; date: string; description: string; amount: number; category_id?: string | null; }

// ── SVG Donut ─────────────────────────────────────────────────────────────────
function DonutChart({ cats, total }: { cats: CatSpend[]; total: number }) {
  const CX = 185; const CY = 165;
  const R_OUTER = 90; const R_INNER = 56; const R_ICON = 118;
  const R_LINE_START = R_OUTER + 2;

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

  return (
    <svg viewBox="0 0 370 330" width="100%" height={290} style={{ display: 'block', overflow: 'visible' }}>
      {slices.map((s, i) => {
        if (s.pct < 0.008) return null;
        const GAP = s.pct < 0.03 ? 0.4 : 1.2;
        return <path key={i} d={arc(s.startA + GAP / 2, s.endA - GAP / 2, R_OUTER, R_INNER)} fill={s.color} />;
      })}
      {slices.map((s, i) => {
        if (s.pct < 0.008) return null;
        const midAngle = s.startA + (s.endA - s.startA) / 2;
        const iconR = s.pct < 0.04 ? R_ICON - 5 : R_ICON;
        const iconCircleR = s.pct < 0.04 ? 11 : 14;
        const lineEndPt = polar(midAngle, iconR - iconCircleR);
        const lineStartPt = polar(midAngle, R_LINE_START);
        const prevMid = i > 0 ? slices[i-1].startA + (slices[i-1].endA - slices[i-1].startA) / 2 : 9999;
        const nextMid = i < slices.length-1 ? slices[i+1].startA + (slices[i+1].endA - slices[i+1].startA) / 2 : 9999;
        const crowded = Math.abs(midAngle - prevMid) < 20 || Math.abs(midAngle - nextMid) < 20;
        const labelR = iconR + iconCircleR + (crowded ? 16 : 12);
        const labelPos = polar(midAngle, labelR);
        const iconPos = polar(midAngle, iconR);
        return (
          <g key={i}>
            <line x1={lineStartPt.x} y1={lineStartPt.y} x2={lineEndPt.x} y2={lineEndPt.y} stroke={s.color} strokeWidth={s.pct < 0.04 ? 1.2 : 1.8} opacity={0.9} />
            <circle cx={iconPos.x} cy={iconPos.y} r={iconCircleR} fill={s.color} />
            <text x={iconPos.x} y={iconPos.y} textAnchor="middle" dominantBaseline="middle" fontSize={s.pct < 0.04 ? 11 : 14}>{s.icon}</text>
            {s.pct >= 0.025 && (
              <text x={labelPos.x} y={labelPos.y} textAnchor="middle" dominantBaseline="middle" fill={s.color} fontSize={9.5} fontWeight={700}>
                {`${(s.pct * 100).toFixed(1)}%`}
              </text>
            )}
          </g>
        );
      })}
      <text x={CX} y={CY - 9} textAnchor="middle" fill="white" fontSize={15} fontWeight={700}>-{formatCurrency(total)}</text>
      <text x={CX} y={CY + 10} textAnchor="middle" fill="#64748b" fontSize={10}>Gastos totales</text>
    </svg>
  );
}

// ── Bar Chart ─────────────────────────────────────────────────────────────────
interface BarSegment { amount: number; color: string; }
interface BarEntry { label: string; amount: number; segments?: BarSegment[]; }

function BarChart({ data, color, mode }: { data: BarEntry[]; color: string; mode: ViewMode }) {
  const W = 320; const H = 110; const PAD_L = 36; const PAD_B = 22; const PAD_T = 8; const PAD_R = 8;
  const chartW = W - PAD_L - PAD_R; const chartH = H - PAD_B - PAD_T;
  const max = Math.max(...data.map(d => d.amount), 1);
  const yTicks = [0, max * 0.5, max];
  function fmtAmt(v: number) { if (v === 0) return '0'; if (v >= 1000) return `${(v/1000).toFixed(1)}k`; return Math.round(v).toString(); }
  const barW = Math.max(4, (chartW / data.length) * 0.55);
  const barGap = chartW / data.length;
  const showEvery = data.length > 20 ? 7 : data.length > 10 ? 3 : 1;
  const baseY = PAD_T + chartH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
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
        const opacity = i === data.length - 1 && mode === 'months' ? 0.5 : 1;
        const segs = d.segments && d.segments.length > 0 ? d.segments : [{ amount: d.amount, color: d.amount > 0 ? color : '#1e293b' }];
        const totalBarH2 = totalBarH;
        const clipId = `clip-${i}`;
        let stackY = baseY;
        return <g key={i}>
          <defs>
            <clipPath id={clipId}>
              <rect x={x} y={baseY - totalBarH2} width={barW} height={totalBarH2} rx={2} ry={2} />
            </clipPath>
          </defs>
          {segs.map((seg, si) => {
            const segH = Math.max(0, (seg.amount / max) * chartH);
            stackY -= segH;
            return <rect key={si} x={x} y={stackY} width={barW} height={Math.max(segH, si === 0 && d.amount > 0 ? 2 : 0)}
              fill={seg.color} opacity={opacity} clipPath={`url(#${clipId})`} />;
          })}
          {i % showEvery === 0 && <text x={PAD_L + i * barGap + barGap / 2} y={H - 6} textAnchor="middle" fill="#475569" fontSize={7.5}>{d.label}</text>}
        </g>;
      })}
      <line x1={PAD_L} y1={PAD_T + chartH} x2={W - PAD_R} y2={PAD_T + chartH} stroke="#1e293b" strokeWidth={1} />
    </svg>
  );
}

function getRange(date: Date, mode: ViewMode) {
  if (mode === 'months') return { start: format(startOfMonth(date), 'yyyy-MM-dd'), end: format(endOfMonth(date), 'yyyy-MM-dd') };
  return { start: format(startOfYear(date), 'yyyy-MM-dd'), end: format(endOfYear(date), 'yyyy-MM-dd') };
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SpendingOverview({ user, onBack }: { user: User; onBack: () => void }) {
  const now = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>('months');
  const [currentDate, setCurrentDate] = useState(now);
  const [catSpending, setCatSpending] = useState<CatSpend[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);
  const swipeStartX = useRef<number | null>(null);

  useEffect(() => { loadData(); }, [viewMode, currentDate]);

  async function loadData() {
    setLoading(true);
    try {
      const range = getRange(currentDate, viewMode);

      // Try RPC first (server-side aggregation — no row limit issues)
      const [{ data: rpcResult, error: rpcError }, catsMap] = await Promise.all([
        supabase.rpc('get_spending_overview', {
          p_user_id: user.id,
          p_start_date: range.start,
          p_end_date: range.end,
        }),
        getCategories(user.id),
      ]);

      const allCats = Array.from(catsMap.values());
      const activeCats = allCats.filter((c: any) => c.deleted !== true);
      const tree = buildTree(activeCats);

      let total = 0;
      const spendMap: Record<string, number> = {};
      const txMap: Record<string, number> = {};

      if (!rpcError && rpcResult) {
        // Use RPC result
        total = Number(rpcResult.total) || 0;
        (rpcResult.category_totals || []).forEach((row: any) => {
          if (row.category_id) {
            spendMap[row.category_id] = Number(row.total);
            txMap[row.category_id] = Number(row.tx_count);
          }
        });
      } else {
        // Fallback: client-side with high limit
        const { data: expenses } = await supabase.from('expenses')
          .select('id, amount, category_id, description, date')
          .eq('user_id', user.id)
          .gte('date', range.start)
          .lte('date', range.end)
          .order('date', { ascending: false })
          .limit(10000);
        const allExp = expenses || [];
        total = allExp.reduce((s: number, e: any) => s + Number(e.amount), 0);
        allExp.forEach((e: any) => {
          if (e.category_id) {
            spendMap[e.category_id] = (spendMap[e.category_id] || 0) + Number(e.amount);
            txMap[e.category_id] = (txMap[e.category_id] || 0) + 1;
          }
        });
      }

      setTotalSpent(total);

      const spending: CatSpend[] = tree
        .map(node => buildSpend(node, spendMap, txMap, total))
        .filter(c => c.spent > 0)
        .sort((a, b) => b.spent - a.spent);

      // Uncategorized
      const allCatIds = new Set(activeCats.map((c: any) => c.id));
      const uncatSpent = (rpcResult?.category_totals || [])
        .filter((row: any) => !row.category_id || !allCatIds.has(row.category_id))
        .reduce((s: number, row: any) => s + Number(row.total), 0);
      const uncatTx = (rpcResult?.category_totals || [])
        .filter((row: any) => !row.category_id || !allCatIds.has(row.category_id))
        .reduce((s: number, row: any) => s + Number(row.tx_count), 0);

      if (uncatSpent > 0) {
        spending.push({ id: 'uncategorized', name: 'Sin categoría', icon: '📦', color: '#95A5A6', spent: uncatSpent, percentage: total > 0 ? (uncatSpent / total) * 100 : 0, transactions: uncatTx, children: [], allIds: ['uncategorized'] });
      }
      setCatSpending(spending);
    } catch (err) { console.error(err); }
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
    return <DrillDownView user={user} drillDown={drillDown} onBack={() => setDrillDown(null)} initialDate={currentDate} initialMode={viewMode} now={now} />;
  }

  // Recursive category list renderer
  function renderCatList(cats: CatSpend[], depth = 0): React.ReactNode {
    return cats.map(cat => {
      const activeChildren = cat.children.filter(c => c.spent > 0);
      const hasChildren = activeChildren.length > 0;
      const isExpanded = expanded.has(cat.id);
      const indent = depth * 16;
      return (
        <div key={cat.id} className="border-b border-dark-800/40">
          <div className="flex items-center gap-2.5 py-2.5" style={{ paddingLeft: `${12 + indent}px`, paddingRight: 12 }}>
            <button onClick={() => openDrillDown(cat)}
              className="rounded-xl flex items-center justify-center text-base flex-shrink-0 active:opacity-70"
              style={{ width: depth === 0 ? 36 : 28, height: depth === 0 ? 36 : 28, fontSize: depth === 0 ? 16 : 13, backgroundColor: cat.color }}>
              {cat.icon}
            </button>
            <button onClick={() => openDrillDown(cat)} className="flex-1 min-w-0 text-left active:opacity-70">
              <p className={`font-semibold ${depth === 0 ? 'text-[12px]' : 'text-[11px] text-dark-200'}`}>{cat.name}</p>
              <p className="text-[10px] text-dark-500">{cat.transactions} {cat.transactions === 1 ? 'transacción' : 'transacciones'}</p>
            </button>
            <span className={`font-bold text-red-400 flex-shrink-0 ${depth === 0 ? 'text-[12px]' : 'text-[11px]'}`}>-{formatCurrency(cat.spent)}</span>
            {hasChildren && (
              <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id); return n; })} className="p-0.5 text-dark-500 ml-0.5">
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
          </div>
          {hasChildren && isExpanded && (
            <div className="border-l border-dark-700/40 ml-8">
              {renderCatList(activeChildren, depth + 1)}
            </div>
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
          <button onClick={() => { setViewMode('months'); setCurrentDate(now); }} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'months' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>Por meses</button>
          <button onClick={() => { setViewMode('years'); setCurrentDate(now); }} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'years' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>Por año</button>
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
          <div className="px-2 mb-2"><DonutChart cats={catSpending} total={totalSpent} /></div>
          <div className="flex items-center justify-between px-4 py-3 mb-1 border-t border-b border-dark-800/60">
            <span className="text-xs text-dark-400 font-medium uppercase tracking-wider">Total gastado</span>
            <span className="text-base font-bold text-red-400">-{formatCurrency(totalSpent)}</span>
          </div>
          <div className="px-3">{renderCatList(catSpending)}</div>
        </>
      )}
    </div>
  );
}

// ── DrillDownView ─────────────────────────────────────────────────────────────
function DrillDownView({ user, drillDown, onBack, initialDate, initialMode, now }: {
  user: User; drillDown: DrillDown; onBack: () => void;
  initialDate: Date; initialMode: ViewMode; now: Date;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [expenses, setExpenses] = useState<ExpenseDetail[]>([]);
  const [barData, setBarData] = useState<BarEntry[]>([]);
  const [periodTotal, setPeriodTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [allCats, setAllCats] = useState<RawCat[]>([]);
  const swipeStartX = useRef<number | null>(null);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  useEffect(() => { loadData(); }, [viewMode, currentDate]);

  async function loadData() {
    setLoading(true);
    try {
      const range = getRange(currentDate, viewMode);

      const catsMap = await getCategories(user.id);
      const cats = Array.from(catsMap.values());
      setAllCats(cats);

      let list: ExpenseDetail[] = [];
      if (drillDown.id === 'uncategorized') {
        const ids = new Set(cats.map((c: any) => c.id));
        const { data: exp } = await supabase.from('expenses').select('id, amount, description, date, category_id').eq('user_id', user.id).gte('date', range.start).lte('date', range.end).order('date', { ascending: false }).limit(10000);
        list = (exp || []).filter((e: any) => !e.category_id || !ids.has(e.category_id)).map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount), category_id: e.category_id }));
      } else {
        const { data: exp } = await supabase.from('expenses').select('id, amount, description, date, category_id').eq('user_id', user.id).in('category_id', drillDown.allIds).gte('date', range.start).lte('date', range.end).order('date', { ascending: false }).limit(10000);
        list = (exp || []).map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount), category_id: e.category_id }));
      }
      setExpenses(list);
      setPeriodTotal(list.reduce((s, e) => s + e.amount, 0));
      setBarData(buildBarData(list, currentDate, viewMode, cats));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  function buildBarData(exp: ExpenseDetail[], date: Date, mode: ViewMode, cats: RawCat[] = allCats): BarEntry[] {
    const colorMap: Record<string, string> = {};
    cats.forEach(c => { colorMap[c.id] = c.color; });

    function makeEntry(label: string, dayExps: ExpenseDetail[]): BarEntry {
      const amount = dayExps.reduce((s, e) => s + e.amount, 0);
      if (amount === 0) return { label, amount, segments: [] };
      const bycat: Record<string, number> = {};
      dayExps.forEach(e => {
        const cid = e.category_id || '__none';
        bycat[cid] = (bycat[cid] || 0) + e.amount;
      });
      const segments: BarSegment[] = Object.entries(bycat)
        .sort((a, b) => b[1] - a[1])
        .map(([cid, amt]) => ({ amount: amt, color: colorMap[cid] || drillDown.color }));
      return { label, amount, segments };
    }

    if (mode === 'months') {
      return eachDayOfInterval({ start: startOfMonth(date), end: endOfMonth(date) }).map(d => {
        const key = format(d, 'yyyy-MM-dd');
        return makeEntry(format(d, 'd'), exp.filter(e => e.date === key));
      });
    }
    return eachMonthOfInterval({ start: startOfYear(date), end: endOfYear(date) }).map(m => {
      const mStr = format(m, 'yyyy-MM');
      return makeEntry(format(m, 'MMM', { locale: es }), exp.filter(e => e.date.startsWith(mStr)));
    });
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

  const isAtPresent = viewMode === 'months' ? format(currentDate, 'yyyy-MM') === format(now, 'yyyy-MM') : currentDate.getFullYear() === now.getFullYear();
  const prevLabel = viewMode === 'months' ? format(subMonths(currentDate, 1), 'MMM yyyy', { locale: es }) : String(currentDate.getFullYear() - 1);
  const nextLabel = isAtPresent ? '' : viewMode === 'months' ? format(addMonths(currentDate, 1), 'MMM yyyy', { locale: es }) : String(currentDate.getFullYear() + 1);
  const periodLabel = viewMode === 'months' ? format(currentDate, 'MMMM yyyy', { locale: es }) : currentDate.getFullYear().toString();

  const todayStr = format(now, 'yyyy-MM-dd');
  const yestStr = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');
  const dayMap = new Map<string, ExpenseDetail[]>();
  expenses.forEach(e => { if (!dayMap.has(e.date)) dayMap.set(e.date, []); dayMap.get(e.date)!.push(e); });
  const grouped = Array.from(dayMap.entries())
    .map(([dateStr, exps]) => ({ date: dateStr, label: dateStr === todayStr ? 'Hoy' : dateStr === yestStr ? 'Ayer' : format(parseISO(dateStr), "d 'de' MMMM", { locale: es }), total: exps.reduce((s, e) => s + e.amount, 0), expenses: exps }))
    .sort((a, b) => b.date.localeCompare(a.date));

  function resolveCat(categoryId: string | null | undefined): RawCat | undefined {
    if (!categoryId) return undefined;
    return allCats.find(c => c.id === categoryId);
  }

  function openEdit(exp: ExpenseDetail) {
    setEditingExpense({
      id: exp.id,
      amount: Number(exp.amount),
      description: exp.description,
      category_id: exp.category_id,
      date: exp.date,
    });
    setShowExpenseModal(true);
  }

  async function deleteExpense(id: string) {
    if (!confirm('¿Eliminar este gasto?')) return;
    await supabase.from('expenses').delete().eq('id', id);
    setExpenses(prev => prev.filter(e => e.id !== id));
    setPeriodTotal(prev => prev - (expenses.find(e => e.id === id)?.amount || 0));
    const updated = expenses.filter(e => e.id !== id);
    setBarData(buildBarData(updated, currentDate, viewMode, allCats));
  }

  return (
    <div className="max-w-lg mx-auto page-transition pb-8" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <button onClick={onBack} className="p-1 text-dark-300 hover:text-white transition-colors"><ArrowLeft size={20} /></button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: drillDown.color }}>{drillDown.icon}</div>
          <h1 className="text-sm font-bold truncate capitalize">{drillDown.name}</h1>
        </div>
      </div>

      <div className="flex justify-center mb-2">
        <div className="inline-flex bg-dark-800 rounded-full p-0.5">
          <button onClick={() => { setViewMode('months'); setCurrentDate(now); }} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'months' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>Por meses</button>
          <button onClick={() => { setViewMode('years'); setCurrentDate(now); }} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'years' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>Por año</button>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 mb-2">
        <button onClick={() => navigate(-1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">← {prevLabel}</button>
        <p className="text-[13px] font-semibold capitalize">{periodLabel}</p>
        {isAtPresent ? <div className="w-20" /> : <button onClick={() => navigate(1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">{nextLabel} →</button>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="px-3 mb-1"><BarChart data={barData} color={drillDown.color} mode={viewMode} /></div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-b border-dark-800/60 mb-1">
            <span className="text-xs text-dark-400 font-medium uppercase tracking-wider">Total en el período</span>
            <span className="text-base font-bold text-red-400">{periodTotal > 0 ? `-${formatCurrency(periodTotal)}` : formatCurrency(0)}</span>
          </div>
          {grouped.length === 0 ? (
            <div className="text-center py-10"><p className="text-dark-500 text-sm">Sin transacciones en este período</p></div>
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
                    const cat = resolveCat(exp.category_id);
                    const displayIcon = cat?.icon || drillDown.icon;
                    const displayColor = cat?.color || drillDown.color;
                    const displayName = cat?.name || drillDown.name;
                    return (
                      <SwipeableRow key={exp.id} onDelete={() => deleteExpense(exp.id)}>
                        <div onClick={() => openEdit(exp)} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-dark-800/40 bg-dark-900 active:bg-dark-700/40 cursor-pointer transition-colors">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: displayColor }}>{displayIcon}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold truncate">{displayName}</p>
                            {exp.description && exp.description !== displayName && (
                              <p className="text-[10px] text-dark-500 truncate">{exp.description}</p>
                            )}
                          </div>
                          <span className="text-[12px] font-bold text-red-400 flex-shrink-0">-{formatCurrency(exp.amount)}</span>
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
