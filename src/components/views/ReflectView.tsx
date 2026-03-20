'use client';

import React, { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfYear, endOfYear, endOfMonth, subYears } from 'date-fns';
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
  prevYearCats: Record<string, number> | null;
  prevYearMonths: Record<string, number> | null; // month label -> amount
}

interface RawCat { id: string; name: string; icon: string; color: string; parent_id: string | null; }
interface CatNode extends RawCat { children: CatNode[]; }

function buildTree(flat: RawCat[]): CatNode[] {
  const map = new Map<string, CatNode>();
  flat.forEach(c => map.set(c.id, { ...c, children: [] }));
  const roots: CatNode[] = [];
  flat.forEach(c => {
    if (c.parent_id && map.has(c.parent_id)) map.get(c.parent_id)!.children.push(map.get(c.id)!);
    else roots.push(map.get(c.id)!);
  });
  return roots;
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
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = format(now, 'yyyy-MM');

  const [year, setYear] = useState(currentYear);
  const [yearData, setYearData] = useState<Record<number, YearData>>({});
  const [availableYears, setAvailableYears] = useState<number[]>([currentYear]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    try {
      // Find first expense year
      const { data: first } = await supabase
        .from('expenses').select('date').eq('user_id', user.id)
        .order('date', { ascending: true }).limit(1);
      const firstYear = first?.[0] ? new Date(first[0].date).getFullYear() : currentYear;
      const years = Array.from({ length: currentYear - firstYear + 1 }, (_, i) => currentYear - i);
      setAvailableYears(years);

      // Load data for current year + previous year in parallel
      await loadYear(currentYear, firstYear < currentYear ? currentYear - 1 : null);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function loadYear(yr: number, prevYr: number | null) {
    if (yearData[yr]) return;

    const yearStart = format(startOfYear(new Date(yr, 0, 1)), 'yyyy-MM-dd');
    const yearEnd = format(endOfYear(new Date(yr, 0, 1)), 'yyyy-MM-dd');

    const [{ data: expData }, { data: catsData }, prevData] = await Promise.all([
      supabase.from('expenses').select('date, amount, category_id').eq('user_id', user.id)
        .gte('date', yearStart).lte('date', yearEnd),
      supabase.from('categories').select('id, name, icon, color, parent_id').eq('user_id', user.id).neq('deleted', true),
      prevYr ? supabase.from('expenses').select('date, amount, category_id').eq('user_id', user.id)
        .gte('date', format(startOfYear(new Date(prevYr, 0, 1)), 'yyyy-MM-dd'))
        .lte('date', format(endOfYear(new Date(prevYr, 0, 1)), 'yyyy-MM-dd')) : Promise.resolve({ data: null }),
    ]);

    const expenses = expData || [];
    const cats = catsData || [];
    const tree = buildTree(cats);

    // Group by month
    const monthMap: Record<string, number> = {};
    expenses.forEach((e: any) => {
      const mo = e.date.slice(0, 7);
      monthMap[mo] = (monthMap[mo] || 0) + Number(e.amount);
    });

    // Build months array for this year
    const months: MonthData[] = [];
    for (let m = 0; m < 12; m++) {
      const mo = format(new Date(yr, m, 1), 'yyyy-MM');
      if (mo > currentMonth) break;
      const label = format(new Date(yr, m, 1), 'MMM', { locale: es });
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      months.push({ label: cap(label), amount: monthMap[mo] || 0, isCurrent: mo === currentMonth });
    }

    // Compute avg for closed months only
    const closedMonths = months.filter(m => !m.isCurrent);
    const numClosed = Math.max(closedMonths.length, 1);

    // Build category spend map using ONLY closed months
    const closedMonthKeys = new Set(
      closedMonths.map(m => {
        const idx = months.indexOf(m);
        return format(new Date(yr, idx, 1), 'yyyy-MM');
      })
    );
    // Recompute closed month keys from actual month positions
    const closedKeys = new Set<string>();
    for (let m = 0; m < 12; m++) {
      const mo = format(new Date(yr, m, 1), 'yyyy-MM');
      if (mo >= format(new Date(yr, 0, 1), 'yyyy-MM') && mo < currentMonth) closedKeys.add(mo);
    }
    const spendMap: Record<string, number> = {};
    expenses.forEach((e: any) => {
      const mo = e.date.slice(0, 7);
      if (e.category_id && closedKeys.has(mo)) {
        spendMap[e.category_id] = (spendMap[e.category_id] || 0) + Number(e.amount);
      }
    });

    const catData: CatData[] = tree
      .map(node => {
        const d = buildCatData(node, spendMap);
        // Convert total to monthly average
        return { ...d, amount: d.amount / numClosed, children: d.children.map(c => ({ ...c, amount: c.amount / numClosed })) };
      })
      .filter(c => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    // Previous year cat averages + monthly totals
    let prevYearCats: Record<string, number> | null = null;
    let prevYearMonths: Record<string, number> | null = null;
    if (prevData?.data && prevData.data.length > 0) {
      const prevSpendMap: Record<string, number> = {};
      const prevMonthMap: Record<string, number> = {};
      prevData.data.forEach((e: any) => {
        if (e.category_id) prevSpendMap[e.category_id] = (prevSpendMap[e.category_id] || 0) + Number(e.amount);
        // Group by month label (MMM) — use same month position
        const mo = parseInt(e.date.slice(5, 7)) - 1;
        const label = format(new Date(yr - 1, mo, 1), 'MMM', { locale: es });
        const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
        prevMonthMap[cap(label)] = (prevMonthMap[cap(label)] || 0) + Number(e.amount);
      });
      prevYearCats = {};
      prevYearMonths = prevMonthMap;
      tree.forEach(node => {
        const total = sumNode(node, prevSpendMap);
        if (total > 0) prevYearCats![node.name] = total / 12;
      });
    }

    setYearData(prev => ({ ...prev, [yr]: { months, cats: catData, prevYearCats, prevYearMonths } }));
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

    if (closed.length >= 3) {
      const last3 = closed.slice(-3);
      if (last3[0].amount > last3[1].amount && last3[1].amount > last3[2].amount) {
        insights.push({ color: '#22c55e', text: `Llevás <b style="color:#e2e8f0">3 meses bajando</b> el gasto — cada mes gastaste menos que el anterior.` });
      } else if (last3[0].amount < last3[1].amount && last3[1].amount < last3[2].amount) {
        insights.push({ color: '#ef4444', text: `Llevás <b style="color:#e2e8f0">3 meses subiendo</b> el gasto — cada mes gastaste más que el anterior.` });
      }
    }

    // Average comparison vs previous year (same number of months)
    if (d.prevYearMonths && closed.length > 0) {
      // Compute prev year avg for the same months (by label)
      const matchedPrev = closed
        .map(m => d.prevYearMonths![m.label])
        .filter(v => v !== undefined);
      if (matchedPrev.length > 0) {
        const prevAvg = matchedPrev.reduce((s, v) => s + v, 0) / matchedPrev.length;
        const diff = avg - prevAvg;
        const pct = Math.round(Math.abs(diff / prevAvg) * 100);
        if (pct >= 3) {
          const up = diff > 0;
          const firstLabel = closed[0].label;
          const lastLabel = closed[closed.length - 1].label;
          const period = firstLabel === lastLabel ? firstLabel : `${firstLabel}–${lastLabel}`;
          insights.push({
            color: up ? '#ef4444' : '#22c55e',
            text: `Gastás <b style="color:#e2e8f0">${formatCurrency(Math.round(Math.abs(diff)))} ${up ? 'más' : 'menos'} por mes</b> que en el mismo período de ${yr - 1} (${period}).`
          });
        }
      }
    }

    if (d.prevYearCats) {
      const changes = d.cats
        .map(cat => {
          const prev = d.prevYearCats![cat.name];
          if (!prev || prev === 0) return null;
          const diff = ((cat.amount - prev) / prev) * 100;
          if (Math.abs(diff) < 10) return null;
          return { name: cat.name, icon: cat.icon, diff: Math.round(diff), prev, curr: cat.amount };
        })
        .filter(Boolean)
        .sort((a, b) => Math.abs(b!.diff) - Math.abs(a!.diff)) as { name: string; icon: string; diff: number; prev: number; curr: number }[];

      if (changes.length > 0) {
        insights.push({ color: '#475569', text: `<span style="color:#64748b;font-weight:500;">Vs ${yr - 1} — categorías con ≥10% de cambio</span>`, isHeader: true });
        changes.forEach(c => {
          const up = c.diff > 0;
          insights.push({
            color: up ? '#ef4444' : '#22c55e',
            text: `${c.icon} <b style="color:#e2e8f0">${c.name}</b> ${up ? 'subió' : 'bajó'} un <b style="color:${up ? '#ef4444' : '#22c55e'}">${up ? '+' : ''}${c.diff}%</b> — de ${formatCurrency(c.prev)} a ${formatCurrency(c.curr)}/mes.`,
          });
        });
      }
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

  function renderCatRow(cat: CatData, depth: number, parentAmount?: number): React.ReactNode {
    const d = yearData[year];
    const closed = d.months.filter(m => !m.isCurrent);
    const avg = closed.length > 0 ? closed.reduce((s, m) => s + m.amount, 0) / closed.length : 0;
    const maxCat = Math.max(...d.cats.map(c => c.amount), 1);
    const barPct = (cat.amount / maxCat) * 100;
    const totalPct = avg > 0 ? Math.round((cat.amount / avg) * 100) : 0;
    const subPct = parentAmount && parentAmount > 0 ? Math.round((cat.amount / parentAmount) * 100) : 0;
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
              <span className={`${depth === 0 ? 'text-[12px]' : 'text-[11px]'} text-dark-400`}>{formatCurrency(Math.round(cat.amount))}</span>
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
        {hasChildren && isExp && activeChildren.map(c => renderCatRow(c, depth + 1, cat.amount))}
      </div>
    );
  }

  const d = yearData[year];
  const minYear = Math.min(...availableYears);
  const maxYear = Math.max(...availableYears);
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
          <button onClick={() => year > minYear && handleYearChange(year - 1)}
            disabled={year <= minYear}
            className="bg-dark-800 border-none text-dark-300 px-3 py-1.5 rounded-lg text-sm disabled:opacity-20 active:bg-dark-700">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-white px-2 min-w-[40px] text-center">{year}</span>
          <button onClick={() => year < maxYear && handleYearChange(year + 1)}
            disabled={year >= maxYear}
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
              <span className="text-[2rem] font-extrabold text-white">{formatCurrency(Math.round(avg))}</span>
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
                      {formatCurrency(m.amount)}
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
                  <span className="text-[11px] w-14 text-right flex-shrink-0 text-dark-500">{formatCurrency(Math.round(avg))}</span>
                </div>
              )}
            </div>
          </div>

          {/* Category breakdown */}
          {d.cats.length > 0 && (
            <div className="bg-dark-800 rounded-2xl mb-3 overflow-hidden">
              <p className="text-[10px] text-dark-500 uppercase tracking-wider px-4 pt-4 pb-2">Por categoría · promedio mensual</p>
              <div className="px-4">
                {d.cats.map(cat => renderCatRow(cat, 0))}
              </div>
            </div>
          )}

          {/* Insights */}
          {computeInsights(d, year).length > 0 && (
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
