'use client';

import React, { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import Amount from '@/components/ui/Amount';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getCategories } from '@/lib/categoryCache';
import { CatNode, buildTree } from '@/lib/categoryTree';
import { format, startOfYear, endOfYear } from 'date-fns';
import { es } from 'date-fns/locale';

interface Props { user: User; }

interface MonthData { label: string; amount: number; isCurrent: boolean; }
interface CatData {
  id: string; name: string; icon: string; color: string;
  amount: number; children: CatData[];
}
interface Insight { color: string; text: string; isHeader?: boolean; }
interface YearData {
  months: MonthData[];
  cats: CatData[];
  /** Árbol completo de categorías (para resolver nombres/íconos en insights) */
  tree: CatNode[];
  /** Promedio mensual por categoría (padres + hijas) del año anterior — total/12 */
  prevYearCats: Record<string, number> | null;
  /** Promedio mensual total del año anterior — sum(monthly)/12 */
  prevYearAvg: number | null;
}

function sumNode(node: CatNode, spendMap: Record<string, number>): number {
  return (spendMap[node.id] || 0) + node.children.reduce((s, c) => s + sumNode(c, spendMap), 0);
}

function buildCatData(node: CatNode, spendMap: Record<string, number>): CatData {
  const children = node.children
    .map(c => buildCatData(c, spendMap))
    .filter(c => c.amount > 0);
  return {
    id: node.id, name: node.name, icon: node.icon, color: node.color,
    amount: sumNode(node, spendMap),
    children,
  };
}

export default function ReflectView({ user }: Props) {
  const [year, setYear] = useState<number | null>(null);
  const [currentMonth, setCurrentMonth] = useState<string>('');
  const [yearData, setYearData] = useState<Record<number, YearData>>({});
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const yearDataRef = useRef<Record<number, YearData>>({});

  useEffect(() => {
    const now = new Date();
    const cy = now.getFullYear();
    const cm = format(now, 'yyyy-MM');
    setYear(cy);
    setCurrentMonth(cm);
    init(cy, cm);
  }, []);

  useEffect(() => {
    yearDataRef.current = yearData;
  }, [yearData]);

  async function init(cy: number, cm: string) {
    setLoading(true);
    try {
      const { data: first } = await supabase
        .from('expenses').select('date').eq('user_id', user.id)
        .order('date', { ascending: true }).limit(1);
      const firstYear = first?.[0] ? new Date(first[0].date).getFullYear() : cy;
      const years = Array.from({ length: cy - firstYear + 1 }, (_, i) => cy - i);
      setAvailableYears(years);
      await loadYear(cy, firstYear < cy ? cy - 1 : null, cm);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function loadPrevYearData(prevYr: number): Promise<{
    monthMap: Record<string, number>;
    catMap: Record<string, number>;
  }> {
    const pStart = format(startOfYear(new Date(prevYr, 0, 1)), 'yyyy-MM-dd');
    const pEnd = format(endOfYear(new Date(prevYr, 0, 1)), 'yyyy-MM-dd');

    const { data: rpcData, error: rpcError } = await supabase.rpc('get_reflect_data', {
      p_user_id: user.id, p_year_start: pStart, p_year_end: pEnd,
    });

    const monthMap: Record<string, number> = {};
    const catMap: Record<string, number> = {};

    const hasRpcData = !rpcError && rpcData
      && Array.isArray(rpcData.monthly_totals) && rpcData.monthly_totals.length > 0;

    if (hasRpcData) {
      rpcData.monthly_totals.forEach((row: any) => {
        monthMap[row.month] = Number(row.total);
      });
      (rpcData.category_totals || []).forEach((row: any) => {
        if (row.category_id) {
          catMap[row.category_id] = (catMap[row.category_id] || 0) + Number(row.total);
        }
      });
    } else {
      const { data: expData } = await supabase.from('expenses')
        .select('date, amount, category_id').eq('user_id', user.id)
        .gte('date', pStart).lte('date', pEnd).limit(10000);

      (expData || []).forEach((e: any) => {
        const mo = e.date.slice(0, 7);
        monthMap[mo] = (monthMap[mo] || 0) + Number(e.amount);
        if (e.category_id) {
          catMap[e.category_id] = (catMap[e.category_id] || 0) + Number(e.amount);
        }
      });
    }

    return { monthMap, catMap };
  }

  async function loadYear(yr: number, prevYr: number | null, cm?: string) {
    if (yearDataRef.current[yr]) return;

    const activeMonth = cm || currentMonth;
    const yearStart = format(startOfYear(new Date(yr, 0, 1)), 'yyyy-MM-dd');
    const yearEnd = format(endOfYear(new Date(yr, 0, 1)), 'yyyy-MM-dd');

    const [{ data: rpcResult, error: rpcError }, catsMap] = await Promise.all([
      supabase.rpc('get_reflect_data', { p_user_id: user.id, p_year_start: yearStart, p_year_end: yearEnd }),
      getCategories(user.id),
    ]);

    const cats = Array.from(catsMap.values());
    const tree = buildTree(cats);

    let monthMap: Record<string, number> = {};
    let catMonthMap: Record<string, Record<string, number>> = {};

    if (!rpcError && rpcResult) {
      (rpcResult.monthly_totals || []).forEach((row: any) => {
        monthMap[row.month] = Number(row.total);
      });
      (rpcResult.category_totals || []).forEach((row: any) => {
        if (!catMonthMap[row.category_id]) catMonthMap[row.category_id] = {};
        catMonthMap[row.category_id][row.month] = Number(row.total);
      });
    } else {
      const { data: expData } = await supabase.from('expenses')
        .select('date, amount, category_id').eq('user_id', user.id)
        .gte('date', yearStart).lte('date', yearEnd).limit(10000);
      (expData || []).forEach((e: any) => {
        const mo = e.date.slice(0, 7);
        monthMap[mo] = (monthMap[mo] || 0) + Number(e.amount);
        if (e.category_id) {
          if (!catMonthMap[e.category_id]) catMonthMap[e.category_id] = {};
          catMonthMap[e.category_id][mo] = (catMonthMap[e.category_id][mo] || 0) + Number(e.amount);
        }
      });
    }

    // Build months array
    const months: MonthData[] = [];
    for (let m = 0; m < 12; m++) {
      const mo = format(new Date(yr, m, 1), 'yyyy-MM');
      if (mo > activeMonth) break;
      const label = format(new Date(yr, m, 1), 'MMM', { locale: es });
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      months.push({ label: cap(label), amount: monthMap[mo] || 0, isCurrent: mo === activeMonth });
    }

    const closedMonths = months.filter(m => !m.isCurrent);
    const numClosed = Math.max(closedMonths.length, 1);

    // Build spend map from closed months only
    const closedKeys = new Set<string>();
    for (let m = 0; m < 12; m++) {
      const mo = format(new Date(yr, m, 1), 'yyyy-MM');
      if (mo < activeMonth) closedKeys.add(mo);
    }

    const spendMap: Record<string, number> = {};
    Object.entries(catMonthMap).forEach(([catId, monthTotals]) => {
      Object.entries(monthTotals).forEach(([mo, total]) => {
        if (closedKeys.has(mo)) {
          spendMap[catId] = (spendMap[catId] || 0) + total;
        }
      });
    });

    const catData: CatData[] = tree
      .map(node => {
        const d = buildCatData(node, spendMap);
        return { ...d, amount: d.amount / numClosed, children: d.children.map(c => ({ ...c, amount: c.amount / numClosed })) };
      })
      .filter(c => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    // Previous year — load separately with fallback, always divide by 12
    let prevYearCats: Record<string, number> | null = null;
    let prevYearAvg: number | null = null;

    if (prevYr != null) {
      const prev = await loadPrevYearData(prevYr);

      let prevTotal = 0;
      Object.values(prev.monthMap).forEach(v => { prevTotal += v; });

      if (prevTotal > 0) {
        prevYearAvg = prevTotal / 12;
        prevYearCats = {};

        // Por cada categoría padre e hija: total / 12
        tree.forEach(node => {
          const parentTotal = sumNode(node, prev.catMap);
          if (parentTotal > 0) prevYearCats![node.id] = parentTotal / 12;
          // Hijas: cada subcategoría con su propio total / 12
          node.children.forEach(child => {
            const childTotal = sumNode(child, prev.catMap);
            if (childTotal > 0) prevYearCats![child.id] = childTotal / 12;
          });
        });
      }
    }

    setYearData(prev => {
      const next = { ...prev, [yr]: { months, cats: catData, tree, prevYearCats, prevYearAvg } };
      yearDataRef.current = next;
      return next;
    });
  }

  async function handleYearChange(newYr: number) {
    setYear(newYr);
    setExpanded(new Set());
    const prevYr = availableYears.includes(newYr - 1) ? newYr - 1 : null;
    await loadYear(newYr, prevYr);
  }

  function computeInsights(d: YearData, yr: number): Insight[] {
    const closed = d.months.filter(m => !m.isCurrent);
    const avg = closed.length > 0 ? closed.reduce((s, m) => s + m.amount, 0) / closed.length : 0;
    const insights: Insight[] = [];

    // Insight 1: tendencia 3 meses consecutivos
    if (closed.length >= 3) {
      const last3 = closed.slice(-3);
      if (last3[0].amount > last3[1].amount && last3[1].amount > last3[2].amount) {
        insights.push({ color: '#22c55e', text: `Llevás <b style="color:#e2e8f0">3 meses bajando</b> el gasto — cada mes gastaste menos que el anterior.` });
      } else if (last3[0].amount < last3[1].amount && last3[1].amount < last3[2].amount) {
        insights.push({ color: '#ef4444', text: `Llevás <b style="color:#e2e8f0">3 meses subiendo</b> el gasto — cada mes gastaste más que el anterior.` });
      }
    }

    // Insight 2: promedio meses cerrados del año actual vs promedio mensual año anterior (total/12)
    if (d.prevYearAvg != null && d.prevYearAvg > 0 && closed.length > 0) {
      const diff = avg - d.prevYearAvg;
      const pct = Math.round(Math.abs(diff / d.prevYearAvg) * 100);
      if (pct >= 3) {
        const up = diff > 0;
        insights.push({
          color: up ? '#ef4444' : '#22c55e',
          text: `Gastás <b style="color:#e2e8f0">${formatCurrency(Math.round(Math.abs(diff)))} ${up ? 'más' : 'menos'} por mes</b> que el promedio de ${yr - 1} (<b style="color:${up ? '#ef4444' : '#22c55e'}">${up ? '+' : ''}${pct}%</b>).`
        });
      }
    }

    // Insight 3: categorías padre con ≥10% de cambio vs promedio mensual año anterior
    // Incluye categorías que bajaron a 0 (-100%)
    if (d.prevYearCats && Object.keys(d.prevYearCats).length > 0) {
      // Build a map of current cat amounts by ID (padres)
      const currentParentMap: Record<string, { name: string; icon: string; amount: number }> = {};
      d.cats.forEach(cat => {
        currentParentMap[cat.id] = { name: cat.name, icon: cat.icon, amount: cat.amount };
      });

      // Build full info map from tree for categories that might have disappeared
      const treeParentInfo: Record<string, { name: string; icon: string }> = {};
      d.tree.forEach(node => {
        treeParentInfo[node.id] = { name: node.name, icon: node.icon };
      });

      const changes: { id: string; name: string; icon: string; diff: number; prev: number; curr: number }[] = [];

      // Categorías con gasto actual — comparar vs previo
      d.cats.forEach(cat => {
        const prev = d.prevYearCats![cat.id];
        if (!prev || prev === 0) return;
        const diff = ((cat.amount - prev) / prev) * 100;
        if (Math.abs(diff) < 10) return;
        changes.push({ id: cat.id, name: cat.name, icon: cat.icon, diff: Math.round(diff), prev, curr: cat.amount });
      });

      // Categorías que tenían gasto antes y ahora son 0 → -100%
      Object.entries(d.prevYearCats).forEach(([catId, prevAmt]) => {
        if (currentParentMap[catId]) return; // ya evaluada arriba
        const info = treeParentInfo[catId];
        if (!info) return; // solo padres en esta sección
        changes.push({ id: catId, name: info.name, icon: info.icon, diff: -100, prev: prevAmt, curr: 0 });
      });

      changes.sort((a, b) => b.diff - a.diff);

      if (changes.length > 0) {
        insights.push({ color: '#475569', text: `<span style="color:#64748b;font-weight:500;">Vs promedio mensual ${yr - 1} — categorías con ≥10% de cambio</span>`, isHeader: true });
        changes.forEach(c => {
          const up = c.diff > 0;
          insights.push({
            color: up ? '#ef4444' : '#22c55e',
            text: `${c.icon} <b style="color:#e2e8f0">${c.name}</b> ${up ? 'subió' : 'bajó'} un <b style="color:${up ? '#ef4444' : '#22c55e'}">${up ? '+' : ''}${c.diff}%</b> — de ${formatCurrency(c.prev)} a ${formatCurrency(c.curr)}/mes.`,
          });
        });
      }

      // Insights 4 y 5 solo desde 2027
      if (yr >= 2027) {

        // Insight 4: subcategorías con ≥10% de cambio (incluye -100%)
        const subChanges: { parentIcon: string; name: string; diff: number; prev: number; curr: number }[] = [];

        // Build current sub amounts map
        const currentSubMap: Record<string, { parentIcon: string; name: string; amount: number }> = {};
        d.cats.forEach(parent => {
          parent.children.forEach(child => {
            currentSubMap[child.id] = { parentIcon: parent.icon, name: child.name, amount: child.amount };
          });
        });

        // Build full sub info from tree
        const treeSubInfo: Record<string, { parentIcon: string; name: string }> = {};
        d.tree.forEach(node => {
          node.children.forEach(child => {
            treeSubInfo[child.id] = { parentIcon: node.icon, name: child.name };
          });
        });

        // Subs con gasto actual
        d.cats.forEach(parent => {
          parent.children.forEach(child => {
            const prev = d.prevYearCats![child.id];
            if (!prev || prev === 0) return;
            const diff = ((child.amount - prev) / prev) * 100;
            const roundedDiff = Math.round(diff);
            if (Math.abs(roundedDiff) < 10) return;
            subChanges.push({ parentIcon: parent.icon, name: child.name, diff: roundedDiff, prev, curr: child.amount });
          });
        });

        // Subs que bajaron a 0
        Object.entries(d.prevYearCats).forEach(([catId, prevAmt]) => {
          if (currentSubMap[catId]) return; // ya evaluada
          const info = treeSubInfo[catId];
          if (!info) return; // solo subcategorías
          subChanges.push({ parentIcon: info.parentIcon, name: info.name, diff: -100, prev: prevAmt, curr: 0 });
        });

        if (subChanges.length > 0) {
          subChanges.sort((a, b) => b.diff - a.diff);

          insights.push({ color: '#475569', text: `<span style="color:#64748b;font-weight:500;">Detalle por subcategoría</span>`, isHeader: true });
          subChanges.forEach(c => {
            const up = c.diff > 0;
            insights.push({
              color: up ? '#ef4444' : '#22c55e',
              text: `${c.parentIcon} <b style="color:#e2e8f0">${c.name}</b> ${up ? 'subió' : 'bajó'} un <b style="color:${up ? '#ef4444' : '#22c55e'}">${up ? '+' : ''}${c.diff}%</b> — de ${formatCurrency(c.prev)} a ${formatCurrency(c.curr)}/mes.`,
            });
          });
        }

        // Insight 5: gastos nuevos (padres e hijas) — solo ≥1% del gasto mensual
        const minRelevant = avg * 0.01;
        const newCats: { icon: string; name: string; amount: number }[] = [];

        d.cats.forEach(cat => {
          const prev = d.prevYearCats![cat.id];
          if (!prev && cat.amount >= minRelevant) {
            newCats.push({ icon: cat.icon, name: cat.name, amount: cat.amount });
          }
          cat.children.forEach(child => {
            const childPrev = d.prevYearCats![child.id];
            if (!childPrev && child.amount >= minRelevant) {
              newCats.push({ icon: cat.icon, name: child.name, amount: child.amount });
            }
          });
        });

        if (newCats.length > 0) {
          insights.push({ color: '#475569', text: `<span style="color:#64748b;font-weight:500;">Gastos nuevos vs ${yr - 1}</span>`, isHeader: true });
          newCats.sort((a, b) => b.amount - a.amount).forEach(c => {
            insights.push({
              color: '#f59e0b',
              text: `${c.icon} <b style="color:#e2e8f0">${c.name}</b> es un gasto nuevo — <b style="color:#f59e0b">${formatCurrency(Math.round(c.amount))}/mes</b>.`,
            });
          });
        }

      } // end yr >= 2027
    }

    return insights;
  }

  function toggleCat(id: string) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function renderCatRow(cat: CatData, depth: number): React.ReactNode {
    const d = year ? yearData[year] : null;
    if (!d) return null;
    const closed = d.months.filter(m => !m.isCurrent);
    const avg = closed.length > 0 ? closed.reduce((s, m) => s + m.amount, 0) / closed.length : 0;
    const maxCat = Math.max(...d.cats.map(c => c.amount), 1);
    const barPct = (cat.amount / maxCat) * 100;
    const totalPct = avg > 0 ? Math.round((cat.amount / avg) * 100) : 0;
    const activeChildren = cat.children.filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);
    const hasChildren = activeChildren.length > 0;
    const isExp = expanded.has(cat.id);
    const indent = depth * 20;

    return (
      <div key={cat.id}>
        <div style={{ paddingLeft: indent }} className={`flex items-center gap-2.5 py-2.5 ${depth === 0 ? 'border-b border-dark-800/60' : ''}`}>
          <div className="rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ width: depth === 0 ? 32 : 26, height: depth === 0 ? 32 : 26, fontSize: depth === 0 ? 14 : 11, backgroundColor: cat.color }}>
            {cat.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between mb-1">
              <span className={`font-semibold ${depth === 0 ? 'text-[12px] text-white' : 'text-[11px] text-dark-200'}`}>{cat.name}</span>
              <Amount value={Math.round(cat.amount)} size="sm" color="text-dark-400" weight="medium" className={depth === 0 ? 'text-[12px]' : 'text-[11px]'} />
            </div>
            {depth === 0 && (
              <div className="w-full bg-dark-700 rounded-full h-1 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: cat.color }} />
              </div>
            )}
          </div>
          <span className="text-[10px] text-dark-500 w-7 text-right flex-shrink-0">{totalPct > 0 ? `${totalPct}%` : ''}</span>
          {hasChildren && depth === 0 ? (
            <button onClick={() => toggleCat(cat.id)} className="text-dark-500 p-0.5 ml-0.5">
              {isExp ? <span style={{ fontSize: 14 }}>˅</span> : <ChevronRight size={13} />}
            </button>
          ) : <div className="w-5" />}
        </div>
        {hasChildren && isExp && activeChildren.map(c => renderCatRow(c, depth + 1))}
      </div>
    );
  }

  const d = year ? yearData[year] : null;
  const minYear = availableYears.length > 0 ? Math.min(...availableYears) : (year || 0);
  const maxYear = availableYears.length > 0 ? Math.max(...availableYears) : (year || 0);
  const closed = d?.months.filter(m => !m.isCurrent) || [];
  const avg = closed.length > 0 ? closed.reduce((s, m) => s + m.amount, 0) / closed.length : 0;
  const maxAmt = d ? Math.max(...d.months.map(m => m.amount), 1) : 1;
  const first = d?.months[0]?.label;
  const last = d?.months[d.months.length - 1]?.label;

  return (
    <div className="max-w-lg mx-auto px-3 pt-5 pb-24 page-transition">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Reflect</h1>
        <div className="flex items-center gap-1">
          <button onClick={() => year && year > minYear && handleYearChange(year - 1)}
            disabled={!year || year <= minYear}
            className="bg-dark-800 border-none text-dark-300 px-3 py-1.5 rounded-lg text-sm disabled:opacity-20 active:bg-dark-700">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-white px-2 min-w-[40px] text-center">{year ?? ''}</span>
          <button onClick={() => year && year < maxYear && handleYearChange(year + 1)}
            disabled={!year || year >= maxYear}
            className="bg-dark-800 border-none text-dark-300 px-3 py-1.5 rounded-lg text-sm disabled:opacity-20 active:bg-dark-700">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {loading || !d ? (
        <div className="flex justify-center py-20">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Average */}
          <div className="mb-4">
            <p className="text-[10px] text-dark-500 uppercase tracking-wider mb-1">Promedio mensual</p>
            <div className="flex items-baseline gap-2">
              <Amount value={Math.round(avg)} size="xl" weight="extrabold" />
              <span className="text-sm text-dark-500">/ mes</span>
            </div>
            {first && last && (
              <p className="text-[11px] text-dark-500 mt-0.5">
                {first} – {last} · {closed.length} {closed.length === 1 ? 'mes cerrado' : 'meses cerrados'}
              </p>
            )}
          </div>

          {/* Month bars */}
          <div className="bg-dark-800 rounded-2xl p-4 mb-3">
            <p className="text-[10px] text-dark-500 uppercase tracking-wider mb-3">Mes a mes</p>
            <div className="flex flex-col gap-2.5">
              {d.months.map((m, i) => {
                const pct = (m.amount / maxAmt) * 100;
                const opacity = m.isCurrent ? 1 : Math.max(0.15, (i + 1) / d.months.length * 0.85);
                return (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className={`text-[11px] w-7 flex-shrink-0 ${m.isCurrent ? 'text-white font-semibold' : 'text-dark-400'}`}>{m.label}</span>
                    <div className="flex-1 bg-dark-700 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-400 transition-all"
                        style={{ width: `${pct}%`, opacity }} />
                    </div>
                    <span className={`text-[11px] w-14 text-right flex-shrink-0 ${m.isCurrent ? 'text-brand-400 font-semibold' : 'text-dark-400'}`}>
                      <Amount value={m.amount} size="sm" color={m.isCurrent ? 'text-brand-400' : 'text-dark-400'} weight={m.isCurrent ? 'semibold' : 'medium'} className="text-[11px]" />
                    </span>
                  </div>
                );
              })}
              {closed.length > 0 && (
                <div className="flex items-center gap-2.5 pt-2 border-t border-dark-700/60">
                  <span className="text-[11px] w-7 flex-shrink-0 text-dark-600">Avg</span>
                  <div className="flex-1 relative h-1.5">
                    <div className="absolute inset-0 border-t border-dashed border-dark-600" />
                    <div className="absolute top-[-4px] w-0.5 h-3.5 bg-dark-500 rounded"
                      style={{ left: `${(avg / maxAmt) * 100}%`, transform: 'translateX(-50%)' }} />
                  </div>
                  <Amount value={Math.round(avg)} size="sm" color="text-dark-500" weight="medium" className="text-[11px] w-14 text-right flex-shrink-0" />
                </div>
              )}
            </div>
          </div>

          {/* Category breakdown */}
          {d.cats.length > 0 && (
            <div className="bg-dark-800 rounded-2xl mb-3 overflow-hidden">
              <p className="text-[10px] text-dark-500 uppercase tracking-wider px-4 pt-4 pb-2">Promedio mensual · meses cerrados</p>
              <div className="px-4">
                {d.cats.map(cat => renderCatRow(cat, 0))}
              </div>
            </div>
          )}

          {/* Insights */}
          {year && computeInsights(d, year).length > 0 && (
            <div className="bg-dark-800 rounded-2xl p-4">
              <p className="text-[10px] text-dark-500 uppercase tracking-wider mb-3">Insights</p>
              <div className="flex flex-col gap-3">
                {computeInsights(d, year).map((ins, i) => (
                  ins.isHeader ? (
                    <p key={i} className="text-[11px] text-dark-500 mt-1" dangerouslySetInnerHTML={{ __html: ins.text }} />
                  ) : (
                    <div key={i} className="flex gap-2.5 items-start">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: ins.color }} />
                      <p className="text-[12px] text-dark-300 leading-relaxed m-0" dangerouslySetInnerHTML={{ __html: ins.text }} />
                    </div>
                  )
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
