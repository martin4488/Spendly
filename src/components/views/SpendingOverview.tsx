'use client';

import { useState, useEffect, useRef } from 'react';
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
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';

type ViewMode = 'months' | 'years';

interface CatSpend {
  id: string;
  name: string;
  icon: string;
  color: string;
  spent: number;
  percentage: number;
  transactions: number;
  subcategories: CatSpend[];
}

interface ExpenseDetail {
  id: string;
  date: string;
  description: string;
  amount: number;
  category_id?: string | null;
}

interface DrillDown {
  id: string;
  name: string;
  icon: string;
  color: string;
  allIds: string[]; // cat + subcats
  subcategories: { id: string; name: string; icon: string; color: string }[];
}

// ── SVG Donut ────────────────────────────────────────────────────────────────
function DonutChart({ cats, total }: { cats: CatSpend[]; total: number }) {
  const CX = 185; const CY = 165;
  const R_OUTER = 90;
  const R_INNER = 56;
  const R_ICON  = 118;
  const R_LINE_START = R_OUTER + 2;
  const R_LABEL = R_ICON + 28;

  let cumAngle = -90;
  const slices = cats.map(cat => {
    const pct = total > 0 ? cat.spent / total : 0;
    const angle = pct * 360;
    const startA = cumAngle;
    cumAngle += angle;
    return { ...cat, pct, startA, endA: cumAngle };
  });

  function toRad(deg: number) { return (deg * Math.PI) / 180; }
  function polar(deg: number, r: number) {
    return { x: CX + r * Math.cos(toRad(deg)), y: CY + r * Math.sin(toRad(deg)) };
  }
  function arc(s: number, e: number, ro: number, ri: number) {
    const p1 = polar(s, ro), p2 = polar(e, ro);
    const p3 = polar(e, ri), p4 = polar(s, ri);
    const lg = e - s > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${ro} ${ro} 0 ${lg} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${ri} ${ri} 0 ${lg} 0 ${p4.x} ${p4.y} Z`;
  }

  return (
    <svg viewBox="0 0 370 330" width="100%" height={290} style={{ display: 'block', overflow: 'visible' }}>
      {/* Arcs */}
      {slices.map((s, i) => {
        if (s.pct < 0.008) return null;
        const GAP = s.pct < 0.03 ? 0.4 : 1.2;
        return <path key={i} d={arc(s.startA + GAP / 2, s.endA - GAP / 2, R_OUTER, R_INNER)} fill={s.color} />;
      })}

      {/* Connectors + icons + labels */}
      {slices.map((s, i) => {
        if (s.pct < 0.008) return null;
        const midAngle = s.startA + (s.endA - s.startA) / 2;
        const iconR = s.pct < 0.04 ? R_ICON - 5 : R_ICON;
        const iconCircleR = s.pct < 0.04 ? 11 : 14;
        const iconFontSize = s.pct < 0.04 ? 11 : 14;

        // Line goes from donut edge all the way to the icon circle edge — unbroken
        const lineStartPt = polar(midAngle, R_LINE_START);
        const lineEndPt   = polar(midAngle, iconR - iconCircleR); // touch the icon circle

        // Label: pushed further out to avoid overlapping icon
        const prevMid = i > 0 ? slices[i-1].startA + (slices[i-1].endA - slices[i-1].startA) / 2 : 9999;
        const nextMid = i < slices.length-1 ? slices[i+1].startA + (slices[i+1].endA - slices[i+1].startA) / 2 : 9999;
        const crowded = Math.abs(midAngle - prevMid) < 20 || Math.abs(midAngle - nextMid) < 20;
        const labelR = iconR + iconCircleR + (crowded ? 16 : 12);
        const labelPos = polar(midAngle, labelR);
        const iconPos  = polar(midAngle, iconR);

        return (
          <g key={i}>
            {/* Continuous connector line from donut to icon bubble edge */}
            <line
              x1={lineStartPt.x} y1={lineStartPt.y}
              x2={lineEndPt.x}   y2={lineEndPt.y}
              stroke={s.color}
              strokeWidth={s.pct < 0.04 ? 1.2 : 1.8}
              opacity={0.9}
            />
            {/* Icon bubble */}
            <circle cx={iconPos.x} cy={iconPos.y} r={iconCircleR} fill={s.color} />
            <text x={iconPos.x} y={iconPos.y} textAnchor="middle" dominantBaseline="middle" fontSize={iconFontSize}>
              {s.icon}
            </text>
            {/* % label */}
            {s.pct >= 0.025 && (
              <text x={labelPos.x} y={labelPos.y} textAnchor="middle" dominantBaseline="middle"
                fill={s.color} fontSize={9.5} fontWeight={700}>
                {`${(s.pct * 100).toFixed(1)}%`}
              </text>
            )}
          </g>
        );
      })}

      {/* Center */}
      <text x={CX} y={CY - 9} textAnchor="middle" fill="white" fontSize={15} fontWeight={700}>
        -{formatCurrency(total)}
      </text>
      <text x={CX} y={CY + 10} textAnchor="middle" fill="#64748b" fontSize={10}>
        Gastos totales
      </text>
    </svg>
  );
}

// ── Bar Chart para drill-down ────────────────────────────────────────────────
function BarChart({ data, color, mode }: { data: { label: string; amount: number }[]; color: string; mode: ViewMode }) {
  const W = 320; const H = 110;
  const PAD_L = 36; const PAD_B = 22; const PAD_T = 8; const PAD_R = 8;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_B - PAD_T;
  const max = Math.max(...data.map(d => d.amount), 1);

  // Y axis labels
  const yTicks = [0, max * 0.5, max];

  function formatAmt(v: number) {
    if (v === 0) return '0';
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return Math.round(v).toString();
  }

  const barW = Math.max(4, (chartW / data.length) * 0.55);
  const barGap = chartW / data.length;

  // Show fewer x labels if many bars
  const showEvery = data.length > 20 ? 7 : data.length > 10 ? 3 : 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {/* Y gridlines */}
      {yTicks.map((v, i) => {
        const y = PAD_T + chartH - (v / max) * chartH;
        return (
          <g key={i}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#1e293b" strokeWidth={1} strokeDasharray="3,3" />
            <text x={PAD_L - 4} y={y} textAnchor="end" dominantBaseline="middle" fill="#475569" fontSize={8}>
              {formatAmt(v)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const barH = Math.max(2, (d.amount / max) * chartH);
        const x = PAD_L + i * barGap + barGap / 2 - barW / 2;
        const y = PAD_T + chartH - barH;
        const isToday = i === data.length - 1 && mode === 'months';
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={d.amount > 0 ? color : '#1e293b'} rx={2}
              opacity={isToday ? 0.5 : 1} />
            {i % showEvery === 0 && (
              <text x={PAD_L + i * barGap + barGap / 2} y={H - 6}
                textAnchor="middle" fill="#475569" fontSize={7.5}>
                {d.label}
              </text>
            )}
          </g>
        );
      })}

      {/* X axis line */}
      <line x1={PAD_L} y1={PAD_T + chartH} x2={W - PAD_R} y2={PAD_T + chartH} stroke="#1e293b" strokeWidth={1} />
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getRange(date: Date, mode: ViewMode) {
  if (mode === 'months') {
    return { start: format(startOfMonth(date), 'yyyy-MM-dd'), end: format(endOfMonth(date), 'yyyy-MM-dd') };
  }
  return { start: format(startOfYear(date), 'yyyy-MM-dd'), end: format(endOfYear(date), 'yyyy-MM-dd') };
}

// ── Main component ────────────────────────────────────────────────────────────
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
      const [{ data: expenses }, { data: cats }] = await Promise.all([
        supabase.from('expenses').select('id, amount, category_id, description, date')
          .eq('user_id', user.id).gte('date', range.start).lte('date', range.end)
          .order('date', { ascending: false }),
        supabase.from('categories').select('*').eq('user_id', user.id),
      ]);

      const allExpenses = expenses || [];
      const allCats = cats || [];
      const parentCats = allCats.filter((c: any) => !c.parent_id);
      const subcats = allCats.filter((c: any) => c.parent_id);
      const total = allExpenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
      setTotalSpent(total);

      const spending: CatSpend[] = parentCats.map((cat: any) => {
        const children = subcats.filter((sc: any) => sc.parent_id === cat.id);
        const subSpending: CatSpend[] = children.map((sub: any) => {
          const subExp = allExpenses.filter((e: any) => e.category_id === sub.id);
          const subSpent = subExp.reduce((s: number, e: any) => s + Number(e.amount), 0);
          return { id: sub.id, name: sub.name, icon: sub.icon, color: sub.color || cat.color, spent: subSpent, percentage: total > 0 ? (subSpent / total) * 100 : 0, transactions: subExp.length, subcategories: [] };
        }).filter((s: CatSpend) => s.spent > 0).sort((a: CatSpend, b: CatSpend) => b.spent - a.spent);

        const directExp = allExpenses.filter((e: any) => e.category_id === cat.id);
        const directSpent = directExp.reduce((s: number, e: any) => s + Number(e.amount), 0);
        const totalCatSpent = directSpent + subSpending.reduce((s, sc) => s + sc.spent, 0);
        return { id: cat.id, name: cat.name, icon: cat.icon, color: cat.color, spent: totalCatSpent, percentage: total > 0 ? (totalCatSpent / total) * 100 : 0, transactions: directExp.length + subSpending.reduce((s, sc) => s + sc.transactions, 0), subcategories: subSpending };
      }).filter((c: CatSpend) => c.spent > 0).sort((a: CatSpend, b: CatSpend) => b.spent - a.spent);

      const catIds = allCats.map((c: any) => c.id);
      const uncat = allExpenses.filter((e: any) => !e.category_id || !catIds.includes(e.category_id));
      if (uncat.length > 0) {
        const uncatSpent = uncat.reduce((s: number, e: any) => s + Number(e.amount), 0);
        spending.push({ id: 'uncategorized', name: 'Sin categoría', icon: '📦', color: '#95A5A6', spent: uncatSpent, percentage: total > 0 ? (uncatSpent / total) * 100 : 0, transactions: uncat.length, subcategories: [] });
      }

      setCatSpending(spending);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  function openDrillDown(cat: CatSpend) {
    const allIds = cat.id === 'uncategorized'
      ? ['uncategorized']
      : [cat.id, ...cat.subcategories.map(s => s.id)];
    setDrillDown({
      id: cat.id, name: cat.name, icon: cat.icon, color: cat.color,
      allIds,
      subcategories: cat.subcategories.map(s => ({ id: s.id, name: s.name, icon: s.icon, color: s.color })),
    });
  }

  function navigate(dir: 1 | -1) {
    if (viewMode === 'months') {
      const next = dir === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1);
      if (next <= now) setCurrentDate(next);
    } else {
      const next = dir === 1 ? addYears(currentDate, 1) : subYears(currentDate, 1);
      if (next <= now) setCurrentDate(next);
    }
  }

  function onTouchStart(e: React.TouchEvent) { swipeStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null) return;
    const dx = swipeStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) navigate(dx > 0 ? 1 : -1);
    swipeStartX.current = null;
  }

  const periodLabel = viewMode === 'months'
    ? format(currentDate, 'MMMM yyyy', { locale: es })
    : currentDate.getFullYear().toString();

  const prevLabel = viewMode === 'months'
    ? format(subMonths(currentDate, 1), 'MMM yyyy', { locale: es })
    : String(currentDate.getFullYear() - 1);

  const isAtPresent = viewMode === 'months'
    ? format(currentDate, 'yyyy-MM') === format(now, 'yyyy-MM')
    : currentDate.getFullYear() === now.getFullYear();

  const nextLabel = isAtPresent ? '' : (viewMode === 'months'
    ? format(addMonths(currentDate, 1), 'MMM yyyy', { locale: es })
    : String(currentDate.getFullYear() + 1));

  // ── Drill-down view ──────────────────────────────────────────────────────────
  if (drillDown) {
    return (
      <DrillDownView
        user={user}
        drillDown={drillDown}
        onBack={() => setDrillDown(null)}
        initialDate={currentDate}
        initialMode={viewMode}
        now={now}
      />
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto page-transition pb-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center gap-2 px-3 pt-4 pb-2">
        <button onClick={onBack} className="p-1 text-dark-300 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-sm font-bold flex-1 text-center pr-6">Overview</h1>
      </div>

      <div className="flex justify-center mb-2">
        <div className="inline-flex bg-dark-800 rounded-full p-0.5">
          <button onClick={() => { setViewMode('months'); setCurrentDate(now); }}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'months' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>
            Por meses
          </button>
          <button onClick={() => { setViewMode('years'); setCurrentDate(now); }}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'years' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>
            Por año
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 mb-1">
        <button onClick={() => navigate(-1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">← {prevLabel}</button>
        <p className="text-[13px] font-semibold capitalize">{periodLabel}</p>
        {isAtPresent
          ? <div className="w-20" />
          : <button onClick={() => navigate(1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">{nextLabel} →</button>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : catSpending.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-dark-300 text-sm">No hay datos para este período</p>
        </div>
      ) : (
        <>
          <div className="px-2 mb-2">
            <DonutChart cats={catSpending} total={totalSpent} />
          </div>

          <div className="flex items-center justify-between px-4 py-3 mb-1 border-t border-b border-dark-800/60">
            <span className="text-xs text-dark-400 font-medium uppercase tracking-wider">Total gastado</span>
            <span className="text-base font-bold text-red-400">-{formatCurrency(totalSpent)}</span>
          </div>

          <div className="px-3">
            {catSpending.map((cat) => {
              const hasSubs = cat.subcategories.length > 0;
              const isExpanded = expanded.has(cat.id);
              return (
                <div key={cat.id} className="border-b border-dark-800/40">
                  <div className="flex items-center gap-2.5 py-2.5">
                    <button onClick={() => openDrillDown(cat)}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 active:opacity-70"
                      style={{ backgroundColor: cat.color }}>
                      {cat.icon}
                    </button>
                    <button onClick={() => openDrillDown(cat)} className="flex-1 min-w-0 text-left active:opacity-70">
                      <p className="text-[12px] font-semibold">{cat.name}</p>
                      <p className="text-[10px] text-dark-500">{cat.transactions} {cat.transactions === 1 ? 'transacción' : 'transacciones'}</p>
                    </button>
                    <span className="text-[12px] font-bold text-red-400 flex-shrink-0">-{formatCurrency(cat.spent)}</span>
                    {hasSubs && (
                      <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id); return n; })}
                        className="p-0.5 text-dark-500 ml-0.5">
                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    )}
                  </div>
                  {hasSubs && isExpanded && (
                    <div className="pb-1">
                      {cat.subcategories.map((sub, idx) => (
                        <button key={sub.id} onClick={() => openDrillDown(sub)}
                          className={`w-full flex items-center gap-2 pl-4 pr-1 py-2 active:bg-dark-800/40 ${idx < cat.subcategories.length - 1 ? 'border-b border-dark-800/20' : ''}`}>
                          <span className="text-dark-600 text-xs">└</span>
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: sub.color }}>{sub.icon}</div>
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-[11px] font-medium text-dark-200">{sub.name}</p>
                            <p className="text-[10px] text-dark-500">{sub.transactions} {sub.transactions === 1 ? 'transacción' : 'transacciones'}</p>
                          </div>
                          <span className="text-[11px] font-bold text-red-400 flex-shrink-0">-{formatCurrency(sub.spent)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── DrillDownView — chart de columnas + transacciones ───────────────────────
function DrillDownView({
  user, drillDown, onBack, initialDate, initialMode, now,
}: {
  user: User;
  drillDown: DrillDown;
  onBack: () => void;
  initialDate: Date;
  initialMode: ViewMode;
  now: Date;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [expenses, setExpenses] = useState<ExpenseDetail[]>([]);
  const [barData, setBarData] = useState<{ label: string; amount: number }[]>([]);
  const [periodTotal, setPeriodTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const swipeStartX = useRef<number | null>(null);

  useEffect(() => { loadData(); }, [viewMode, currentDate]);

  async function loadData() {
    setLoading(true);
    try {
      const range = getRange(currentDate, viewMode);

      let query = supabase.from('expenses')
        .select('id, amount, description, date, category_id')
        .eq('user_id', user.id)
        .gte('date', range.start)
        .lte('date', range.end)
        .order('date', { ascending: false });

      if (drillDown.id === 'uncategorized') {
        const { data: allCats } = await supabase.from('categories').select('id').eq('user_id', user.id);
        const ids = (allCats || []).map((c: any) => c.id);
        const { data: exp } = await supabase.from('expenses')
          .select('id, amount, description, date, category_id')
          .eq('user_id', user.id).gte('date', range.start).lte('date', range.end)
          .order('date', { ascending: false });
        const filtered = (exp || []).filter((e: any) => !e.category_id || !ids.includes(e.category_id));
        setExpenses(filtered.map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount) })));
        const total = filtered.reduce((s: number, e: any) => s + Number(e.amount), 0);
        setPeriodTotal(total);
        setBarData(buildBarData(filtered, currentDate, viewMode));
      } else {
        const { data: exp } = await query.in('category_id', drillDown.allIds);
        const list = (exp || []).map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount), category_id: e.category_id }));
        setExpenses(list);
        const total = list.reduce((s, e) => s + e.amount, 0);
        setPeriodTotal(total);
        setBarData(buildBarData(list, currentDate, viewMode));
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  function buildBarData(exp: { date: string; amount: number }[], date: Date, mode: ViewMode) {
    if (mode === 'months') {
      const days = eachDayOfInterval({ start: startOfMonth(date), end: endOfMonth(date) });
      return days.map(d => {
        const key = format(d, 'yyyy-MM-dd');
        const amount = exp.filter(e => e.date === key).reduce((s, e) => s + e.amount, 0);
        return { label: format(d, 'd'), amount };
      });
    } else {
      const months = eachMonthOfInterval({ start: startOfYear(date), end: endOfYear(date) });
      return months.map(m => {
        const mStr = format(m, 'yyyy-MM');
        const amount = exp.filter(e => e.date.startsWith(mStr)).reduce((s, e) => s + e.amount, 0);
        return { label: format(m, 'MMM', { locale: es }), amount };
      });
    }
  }

  function navigate(dir: 1 | -1) {
    if (viewMode === 'months') {
      const next = dir === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1);
      if (next <= now) setCurrentDate(next);
    } else {
      const next = dir === 1 ? addYears(currentDate, 1) : subYears(currentDate, 1);
      if (next <= now) setCurrentDate(next);
    }
  }

  function onTouchStart(e: React.TouchEvent) { swipeStartX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null) return;
    const dx = swipeStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) navigate(dx > 0 ? 1 : -1);
    swipeStartX.current = null;
  }

  const isAtPresent = viewMode === 'months'
    ? format(currentDate, 'yyyy-MM') === format(now, 'yyyy-MM')
    : currentDate.getFullYear() === now.getFullYear();

  const prevLabel = viewMode === 'months'
    ? format(subMonths(currentDate, 1), 'MMM yyyy', { locale: es })
    : String(currentDate.getFullYear() - 1);

  const nextLabel = isAtPresent ? '' : viewMode === 'months'
    ? format(addMonths(currentDate, 1), 'MMM yyyy', { locale: es })
    : String(currentDate.getFullYear() + 1);

  const periodLabel = viewMode === 'months'
    ? format(currentDate, 'MMMM yyyy', { locale: es })
    : currentDate.getFullYear().toString();

  // Group expenses by date for list
  const todayStr = format(now, 'yyyy-MM-dd');
  const yestStr  = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');
  const dayMap = new Map<string, ExpenseDetail[]>();
  expenses.forEach(e => {
    if (!dayMap.has(e.date)) dayMap.set(e.date, []);
    dayMap.get(e.date)!.push(e);
  });
  const grouped = Array.from(dayMap.entries())
    .map(([dateStr, exps]) => ({
      date: dateStr,
      label: dateStr === todayStr ? 'Hoy' : dateStr === yestStr ? 'Ayer'
        : format(parseISO(dateStr), "d 'de' MMMM", { locale: es }),
      total: exps.reduce((s, e) => s + e.amount, 0),
      expenses: exps,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="max-w-lg mx-auto page-transition pb-8" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <button onClick={onBack} className="p-1 text-dark-300 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0"
            style={{ backgroundColor: drillDown.color }}>{drillDown.icon}</div>
          <h1 className="text-sm font-bold truncate capitalize">{drillDown.name}</h1>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex justify-center mb-2">
        <div className="inline-flex bg-dark-800 rounded-full p-0.5">
          <button onClick={() => { setViewMode('months'); setCurrentDate(now); }}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'months' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>
            Por meses
          </button>
          <button onClick={() => { setViewMode('years'); setCurrentDate(now); }}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'years' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}>
            Por año
          </button>
        </div>
      </div>

      {/* Period nav */}
      <div className="flex items-center justify-between px-4 mb-2">
        <button onClick={() => navigate(-1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">← {prevLabel}</button>
        <p className="text-[13px] font-semibold capitalize">{periodLabel}</p>
        {isAtPresent
          ? <div className="w-20" />
          : <button onClick={() => navigate(1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">{nextLabel} →</button>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Bar chart */}
          <div className="px-3 mb-1">
            <BarChart data={barData} color={drillDown.color} mode={viewMode} />
          </div>

          {/* Period total */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-b border-dark-800/60 mb-1">
            <span className="text-xs text-dark-400 font-medium uppercase tracking-wider">Total en el período</span>
            <span className="text-base font-bold text-red-400">
              {periodTotal > 0 ? `-${formatCurrency(periodTotal)}` : formatCurrency(0)}
            </span>
          </div>

          {/* Transactions */}
          {grouped.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-dark-500 text-sm">Sin transacciones en este período</p>
            </div>
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
                    const sub = drillDown.subcategories.find(s => s.id === exp.category_id);
                    const displayIcon  = sub ? sub.icon  : drillDown.icon;
                    const displayColor = sub ? sub.color : drillDown.color;
                    const displayName  = sub ? sub.name  : drillDown.name;
                    return (
                      <div key={exp.id} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-dark-800/40">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0"
                          style={{ backgroundColor: displayColor }}>{displayIcon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold truncate">{displayName}</p>
                          {exp.description && exp.description !== displayName && (
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
    </div>
  );
}
