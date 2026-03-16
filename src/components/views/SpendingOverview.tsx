'use client';

import { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { format, parseISO, addMonths, subMonths, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';
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
  categoryName?: string;
  categoryIcon?: string;
  categoryColor?: string;
}

interface DrillDown {
  id: string;
  name: string;
  icon: string;
  color: string;
  expenses: ExpenseDetail[];
}

// ── SVG Donut — estilo Wallet iOS ────────────────────────────────────────────
function DonutChart({ cats, total }: { cats: CatSpend[]; total: number }) {
  // Canvas center and radii
  const CX = 185; const CY = 165;
  const R_OUTER = 90;
  const R_INNER = 56;
  const R_ICON  = 116;
  const R_LINE_START = R_OUTER + 2;
  const R_LINE_END   = R_ICON - 16;
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

  function polar(angleDeg: number, r: number) {
    return {
      x: CX + r * Math.cos(toRad(angleDeg)),
      y: CY + r * Math.sin(toRad(angleDeg)),
    };
  }

  function arc(startDeg: number, endDeg: number, ro: number, ri: number) {
    const s1 = polar(startDeg, ro);
    const e1 = polar(endDeg, ro);
    const s2 = polar(endDeg, ri);
    const e2 = polar(startDeg, ri);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s1.x} ${s1.y} A ${ro} ${ro} 0 ${large} 1 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${ri} ${ri} 0 ${large} 0 ${e2.x} ${e2.y} Z`;
  }

  // Small slices (< 2%) get a tiny icon radius so they don't overlap each other
  // but we still show them — just smaller icon + no label if too tiny
  const SHOW_LABEL_THRESHOLD = 0.025; // 2.5%
  const SHOW_ICON_THRESHOLD  = 0.008; // 0.8% — below this skip entirely

  return (
    <svg
      viewBox="0 0 370 330"
      width="100%"
      height={290}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* ── Arcs ── */}
      {slices.map((s, i) => {
        if (s.pct < SHOW_ICON_THRESHOLD) return null;
        const GAP = s.pct < 0.03 ? 0.4 : 1.2;
        return (
          <path
            key={i}
            d={arc(s.startA + GAP / 2, s.endA - GAP / 2, R_OUTER, R_INNER)}
            fill={s.color}
          />
        );
      })}

      {/* ── Connectors + icons + labels ── */}
      {slices.map((s, i) => {
        if (s.pct < SHOW_ICON_THRESHOLD) return null;

        const midAngle = s.startA + (s.endA - s.startA) / 2;

        // For very small slices, pull icon closer to avoid crowding
        const iconR   = s.pct < 0.04 ? R_ICON - 6 : R_ICON;
        const lineEndR = iconR - 16;
        const labelR  = iconR + (s.pct < 0.04 ? 22 : 28);

        const lineStart = polar(midAngle, R_LINE_START);
        const lineEnd   = polar(midAngle, lineEndR);
        const iconPos   = polar(midAngle, iconR);

        // Anti-overlap: nudge label perpendicular if adjacent slice is close
        const prevSlice = i > 0 ? slices[i - 1] : null;
        const nextSlice = i < slices.length - 1 ? slices[i + 1] : null;
        const angularGapPrev = prevSlice ? Math.abs(midAngle - (prevSlice.startA + (prevSlice.endA - prevSlice.startA) / 2)) : 999;
        const angularGapNext = nextSlice ? Math.abs(midAngle - (nextSlice.startA + (nextSlice.endA - nextSlice.startA) / 2)) : 999;
        const isCrowded = angularGapPrev < 18 || angularGapNext < 18;
        // If crowded, push label further out radially
        const effectiveLabelR = isCrowded ? labelR + 10 : labelR;
        const labelPos  = polar(midAngle, effectiveLabelR);

        const iconSize  = s.pct < 0.04 ? 11 : 14;
        const iconR_circle = s.pct < 0.04 ? 11 : 14;
        const showLabel = s.pct >= SHOW_LABEL_THRESHOLD;

        return (
          <g key={i}>
            {/* Connector line — thick and visible */}
            <line
              x1={lineStart.x} y1={lineStart.y}
              x2={lineEnd.x}   y2={lineEnd.y}
              stroke={s.color}
              strokeWidth={s.pct < 0.04 ? 1.2 : 1.8}
              opacity={0.85}
            />

            {/* Icon bubble */}
            <circle
              cx={iconPos.x} cy={iconPos.y}
              r={iconR_circle}
              fill={s.color}
            />
            <text
              x={iconPos.x} y={iconPos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={iconSize}
            >
              {s.icon}
            </text>

            {/* % label — only for slices big enough */}
            {showLabel && (
              <text
                x={labelPos.x} y={labelPos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={s.color}
                fontSize={9.5}
                fontWeight={700}
              >
                {`${(s.pct * 100).toFixed(1)}%`}
              </text>
            )}
          </g>
        );
      })}

      {/* ── Center total ── */}
      <text
        x={CX} y={CY - 9}
        textAnchor="middle"
        fill="white"
        fontSize={15}
        fontWeight={700}
      >
        -{formatCurrency(total)}
      </text>
      <text
        x={CX} y={CY + 10}
        textAnchor="middle"
        fill="#64748b"
        fontSize={10}
      >
        Gastos totales
      </text>
    </svg>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

function getRange(date: Date, mode: ViewMode) {
  if (mode === 'months') {
    return {
      start: format(startOfMonth(date), 'yyyy-MM-dd'),
      end: format(endOfMonth(date), 'yyyy-MM-dd'),
    };
  }
  return {
    start: format(startOfYear(date), 'yyyy-MM-dd'),
    end: format(endOfYear(date), 'yyyy-MM-dd'),
  };
}

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
          return {
            id: sub.id, name: sub.name, icon: sub.icon, color: sub.color || cat.color,
            spent: subSpent, percentage: total > 0 ? (subSpent / total) * 100 : 0,
            transactions: subExp.length, subcategories: [],
          };
        }).filter((s: CatSpend) => s.spent > 0).sort((a: CatSpend, b: CatSpend) => b.spent - a.spent);

        const directExp = allExpenses.filter((e: any) => e.category_id === cat.id);
        const directSpent = directExp.reduce((s: number, e: any) => s + Number(e.amount), 0);
        const totalCatSpent = directSpent + subSpending.reduce((s, sc) => s + sc.spent, 0);
        return {
          id: cat.id, name: cat.name, icon: cat.icon, color: cat.color,
          spent: totalCatSpent, percentage: total > 0 ? (totalCatSpent / total) * 100 : 0,
          transactions: directExp.length + subSpending.reduce((s, sc) => s + sc.transactions, 0),
          subcategories: subSpending,
        };
      }).filter((c: CatSpend) => c.spent > 0).sort((a: CatSpend, b: CatSpend) => b.spent - a.spent);

      const catIds = allCats.map((c: any) => c.id);
      const uncat = allExpenses.filter((e: any) => !e.category_id || !catIds.includes(e.category_id));
      if (uncat.length > 0) {
        const uncatSpent = uncat.reduce((s: number, e: any) => s + Number(e.amount), 0);
        spending.push({
          id: 'uncategorized', name: 'Sin categoría', icon: '📦', color: '#95A5A6',
          spent: uncatSpent, percentage: total > 0 ? (uncatSpent / total) * 100 : 0,
          transactions: uncat.length, subcategories: [],
        });
      }

      setCatSpending(spending);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function openDrillDown(catId: string, name: string, icon: string, color: string) {
    const range = getRange(currentDate, viewMode);
    if (catId === 'uncategorized') {
      const [{ data: allCats }, { data: exp }] = await Promise.all([
        supabase.from('categories').select('id').eq('user_id', user.id),
        supabase.from('expenses').select('id, amount, description, date').eq('user_id', user.id)
          .gte('date', range.start).lte('date', range.end).order('date', { ascending: false }),
      ]);
      const ids = (allCats || []).map((c: any) => c.id);
      const filtered = (exp || []).filter((e: any) => !e.category_id || !ids.includes(e.category_id));
      setDrillDown({ id: catId, name, icon, color, expenses: filtered.map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount) })) });
    } else {
      const parentCat = catSpending.find(c => c.id === catId);
      const subIds = parentCat ? parentCat.subcategories.map(s => s.id) : [];
      const allIds = [catId, ...subIds];
      const { data: exp } = await supabase.from('expenses')
        .select('id, amount, description, date, category_id')
        .eq('user_id', user.id).in('category_id', allIds)
        .gte('date', range.start).lte('date', range.end)
        .order('date', { ascending: false });
      setDrillDown({ id: catId, name, icon, color, expenses: (exp || []).map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount) })) });
    }
  }

  function navigate(dir: 1 | -1) {
    if (viewMode === 'months') {
      const next = dir === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1);
      if (next <= now) setCurrentDate(next);
    } else {
      const nextYear = currentDate.getFullYear() + dir;
      if (nextYear <= now.getFullYear()) setCurrentDate(new Date(nextYear, 0, 1));
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
    const today = format(now, 'yyyy-MM-dd');
    const yesterday = format(new Date(now.getTime() - 86400000), 'yyyy-MM-dd');
    const dayMap = new Map<string, ExpenseDetail[]>();
    drillDown.expenses.forEach(e => {
      if (!dayMap.has(e.date)) dayMap.set(e.date, []);
      dayMap.get(e.date)!.push(e);
    });
    const grouped = Array.from(dayMap.entries())
      .map(([dateStr, exps]) => ({
        date: dateStr,
        label: dateStr === today ? 'Hoy' : dateStr === yesterday ? 'Ayer' : format(parseISO(dateStr), "d 'de' MMMM", { locale: es }),
        total: exps.reduce((s, e) => s + e.amount, 0),
        expenses: exps,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return (
      <div className="max-w-lg mx-auto page-transition pb-6">
        <div className="flex items-center gap-2 px-3 pt-4 pb-3">
          <button onClick={() => setDrillDown(null)} className="p-1 text-dark-300 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: drillDown.color }}>{drillDown.icon}</div>
            <h1 className="text-sm font-bold truncate">{drillDown.name}</h1>
          </div>
          <span className="text-sm font-bold text-red-400 flex-shrink-0">-{formatCurrency(drillDown.expenses.reduce((s, e) => s + e.amount, 0))}</span>
        </div>
        {grouped.map(group => (
          <div key={group.date}>
            <div className="flex items-center justify-between px-3 py-1 bg-dark-800/60">
              <span className="text-[10px] font-semibold text-dark-500 uppercase tracking-wider capitalize">{group.label}</span>
              <span className="text-[10px] font-semibold text-dark-500">-{formatCurrency(group.total)}</span>
            </div>
            {group.expenses.map(exp => (
              <div key={exp.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-dark-800/40">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: drillDown.color }}>{drillDown.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate">{drillDown.name}</p>
                  {exp.description && exp.description !== drillDown.name && (
                    <p className="text-[10px] text-dark-500 truncate">{exp.description}</p>
                  )}
                </div>
                <span className="text-[12px] font-bold text-red-400 flex-shrink-0">-{formatCurrency(exp.amount)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto page-transition pb-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-4 pb-2">
        <button onClick={onBack} className="p-1 text-dark-300 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-sm font-bold flex-1 text-center pr-6">Overview</h1>
      </div>

      {/* Toggle */}
      <div className="flex justify-center mb-2">
        <div className="inline-flex bg-dark-800 rounded-full p-0.5">
          <button
            onClick={() => { setViewMode('months'); setCurrentDate(now); }}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'months' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}
          >
            Por meses
          </button>
          <button
            onClick={() => { setViewMode('years'); setCurrentDate(now); }}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${viewMode === 'years' ? 'bg-dark-600 text-white' : 'text-dark-400'}`}
          >
            Por año
          </button>
        </div>
      </div>

      {/* Period navigation */}
      <div className="flex items-center justify-between px-4 mb-1">
        <button onClick={() => navigate(-1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">
          ← {prevLabel}
        </button>
        <p className="text-[13px] font-semibold capitalize">{periodLabel}</p>
        {isAtPresent
          ? <div className="w-20" />
          : <button onClick={() => navigate(1)} className="text-[11px] text-dark-500 capitalize py-1 px-2 active:text-dark-300">{nextLabel} →</button>
        }
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
          {/* Donut */}
          <div className="px-2 mb-2">
            <DonutChart cats={catSpending} total={totalSpent} />
          </div>

          {/* Total del período */}
          <div className="flex items-center justify-between px-4 py-3 mb-1 border-t border-b border-dark-800/60">
            <span className="text-xs text-dark-400 font-medium uppercase tracking-wider">Total gastado</span>
            <span className="text-base font-bold text-red-400">-{formatCurrency(totalSpent)}</span>
          </div>

          {/* Category list */}
          <div className="px-3">
            {catSpending.map((cat) => {
              const hasSubs = cat.subcategories.length > 0;
              const isExpanded = expanded.has(cat.id);
              return (
                <div key={cat.id} className="border-b border-dark-800/40">
                  <div className="flex items-center gap-2.5 py-2.5">
                    <button
                      onClick={() => openDrillDown(cat.id, cat.name, cat.icon, cat.color)}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 active:opacity-70"
                      style={{ backgroundColor: cat.color }}
                    >
                      {cat.icon}
                    </button>
                    <button onClick={() => openDrillDown(cat.id, cat.name, cat.icon, cat.color)} className="flex-1 min-w-0 text-left active:opacity-70">
                      <p className="text-[12px] font-semibold">{cat.name}</p>
                      <p className="text-[10px] text-dark-500">{cat.transactions} {cat.transactions === 1 ? 'transacción' : 'transacciones'}</p>
                    </button>
                    <span className="text-[12px] font-bold text-red-400 flex-shrink-0">-{formatCurrency(cat.spent)}</span>
                    {hasSubs && (
                      <button
                        onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id); return n; })}
                        className="p-0.5 text-dark-500 ml-0.5"
                      >
                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    )}
                  </div>
                  {hasSubs && isExpanded && (
                    <div className="pb-1">
                      {cat.subcategories.map((sub, idx) => (
                        <button
                          key={sub.id}
                          onClick={() => openDrillDown(sub.id, sub.name, sub.icon, sub.color)}
                          className={`w-full flex items-center gap-2 pl-4 pr-1 py-2 active:bg-dark-800/40 ${idx < cat.subcategories.length - 1 ? 'border-b border-dark-800/20' : ''}`}
                        >
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
