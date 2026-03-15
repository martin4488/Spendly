'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency, getMonthRange, getYearRange } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

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
}

interface DrillDown {
  id: string;
  name: string;
  icon: string;
  color: string;
  expenses: ExpenseDetail[];
}

export default function SpendingOverview({ user, onBack }: { user: User; onBack: () => void }) {
  const [catSpending, setCatSpending] = useState<CatSpend[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('months');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);

  useEffect(() => { loadData(); }, [viewMode]);

  async function loadData() {
    setLoading(true);
    try {
      const now = new Date();
      const range = viewMode === 'months' ? getMonthRange(now) : getYearRange(now);

      const [{ data: expenses }, { data: cats }] = await Promise.all([
        supabase
          .from('expenses')
          .select('id, amount, category_id, description, date')
          .eq('user_id', user.id)
          .gte('date', range.start)
          .lte('date', range.end)
          .order('date', { ascending: false }),
        supabase
          .from('categories')
          .select('*')
          .eq('user_id', user.id),
      ]);

      const allExpenses = expenses || [];
      const allCats = cats || [];
      const parentCats = allCats.filter((c: any) => !c.parent_id);
      const subcats = allCats.filter((c: any) => c.parent_id);

      const total = allExpenses.reduce((sum: number, e: any) => sum + Number(e.amount), 0);
      setTotalSpent(total);

      const spending: CatSpend[] = parentCats.map((cat: any) => {
        const children = subcats.filter((sc: any) => sc.parent_id === cat.id);
        const subSpending: CatSpend[] = children.map((sub: any) => {
          const subExp = allExpenses.filter((e: any) => e.category_id === sub.id);
          const subSpent = subExp.reduce((s: number, e: any) => s + Number(e.amount), 0);
          return {
            id: sub.id,
            name: sub.name,
            icon: sub.icon,
            color: sub.color || cat.color,
            spent: subSpent,
            percentage: total > 0 ? (subSpent / total) * 100 : 0,
            transactions: subExp.length,
            subcategories: [],
          };
        }).filter((s: CatSpend) => s.spent > 0).sort((a: CatSpend, b: CatSpend) => b.spent - a.spent);

        const directExp = allExpenses.filter((e: any) => e.category_id === cat.id);
        const directSpent = directExp.reduce((s: number, e: any) => s + Number(e.amount), 0);
        const totalCatSpent = directSpent + subSpending.reduce((s, sc) => s + sc.spent, 0);
        const totalCatTx = directExp.length + subSpending.reduce((s, sc) => s + sc.transactions, 0);

        return {
          id: cat.id,
          name: cat.name,
          icon: cat.icon,
          color: cat.color,
          spent: totalCatSpent,
          percentage: total > 0 ? (totalCatSpent / total) * 100 : 0,
          transactions: totalCatTx,
          subcategories: subSpending,
        };
      }).filter((c: CatSpend) => c.spent > 0).sort((a: CatSpend, b: CatSpend) => b.spent - a.spent);

      // Sin categoría
      const catIds = allCats.map((c: any) => c.id);
      const uncategorized = allExpenses.filter((e: any) => !e.category_id || !catIds.includes(e.category_id));
      if (uncategorized.length > 0) {
        const uncatSpent = uncategorized.reduce((s: number, e: any) => s + Number(e.amount), 0);
        spending.push({
          id: 'uncategorized',
          name: 'Sin categoría',
          icon: '📦',
          color: '#95A5A6',
          spent: uncatSpent,
          percentage: total > 0 ? (uncatSpent / total) * 100 : 0,
          transactions: uncategorized.length,
          subcategories: [],
        });
      }

      setCatSpending(spending);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function openDrillDown(catId: string, name: string, icon: string, color: string) {
    const now = new Date();
    const range = viewMode === 'months' ? getMonthRange(now) : getYearRange(now);

    if (catId === 'uncategorized') {
      const [{ data: allCats }, { data: exp }] = await Promise.all([
        supabase.from('categories').select('id').eq('user_id', user.id),
        supabase.from('expenses').select('id, amount, description, date')
          .eq('user_id', user.id).gte('date', range.start).lte('date', range.end)
          .order('date', { ascending: false }),
      ]);
      const catIds = (allCats || []).map((c: any) => c.id);
      const filtered = (exp || []).filter((e: any) => !e.category_id || !catIds.includes(e.category_id));
      setDrillDown({ id: catId, name, icon, color, expenses: filtered.map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount) })) });
    } else {
      // Check if this is a parent category (has subcategories in catSpending)
      const parentCat = catSpending.find(c => c.id === catId);
      const subIds = parentCat ? parentCat.subcategories.map(s => s.id) : [];
      const allIds = [catId, ...subIds];

      const { data: exp } = await supabase
        .from('expenses')
        .select('id, amount, description, date, category_id')
        .eq('user_id', user.id)
        .in('category_id', allIds)
        .gte('date', range.start)
        .lte('date', range.end)
        .order('date', { ascending: false });
      setDrillDown({ id: catId, name, icon, color, expenses: (exp || []).map((e: any) => ({ id: e.id, date: e.date, description: e.description, amount: Number(e.amount) })) });
    }
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const now = new Date();
  const periodLabel = viewMode === 'months'
    ? format(now, 'MMMM yyyy', { locale: es })
    : now.getFullYear().toString();

  const donutData = catSpending.map(c => ({ name: c.name, value: c.spent, color: c.color }));

  // ── Drill-down view ────────────────────────────────────────────────────────
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

    const drillTotal = drillDown.expenses.reduce((s, e) => s + e.amount, 0);

    return (
      <div className="max-w-lg mx-auto page-transition pb-6">
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <button onClick={() => setDrillDown(null)} className="p-1 text-dark-300 hover:text-white transition-colors">
            <ArrowLeft size={22} />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: drillDown.color }}>
              {drillDown.icon}
            </div>
            <h1 className="text-base font-bold truncate">{drillDown.name}</h1>
          </div>
          <span className="text-sm font-bold text-red-400 flex-shrink-0">-{formatCurrency(drillTotal)}</span>
        </div>

        {drillDown.expenses.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">🔍</div>
            <p className="text-dark-300">No hay gastos en este período</p>
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.date}>
              <div className="flex items-center justify-between px-4 py-1.5 bg-dark-800/80 mt-2 first:mt-0">
  <span className="text-[11px] font-semibold text-dark-500 uppercase tracking-widest capitalize">{group.label}</span>
  <span className="text-[11px] font-semibold text-dark-500">-{formatCurrency(group.total)}</span>
</div>
              {group.expenses.map(exp => (
                <div key={exp.id} className="flex items-center gap-3.5 px-4 py-3 border-b border-dark-800/40">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: drillDown.color }}>
                    {drillDown.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate">{exp.description || drillDown.name}</p>
                  </div>
                  <span className="text-[13px] font-bold text-red-400 flex-shrink-0">-{formatCurrency(exp.amount)}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-3 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto page-transition pb-4">
      <div className="flex items-center gap-3 px-4 pt-5 pb-3">
        <button onClick={onBack} className="p-1 text-dark-300 hover:text-white transition-colors">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold flex-1 text-center pr-8">Overview</h1>
      </div>

      <div className="flex justify-center mb-4">
        <div className="inline-flex bg-dark-800 rounded-full p-0.5">
          <button onClick={() => setViewMode('months')} className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${viewMode === 'months' ? 'bg-dark-600 text-white shadow-sm' : 'text-dark-400'}`}>Por meses</button>
          <button onClick={() => setViewMode('years')} className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${viewMode === 'years' ? 'bg-dark-600 text-white shadow-sm' : 'text-dark-400'}`}>Por año</button>
        </div>
      </div>

      <p className="text-center text-sm text-dark-400 capitalize mb-4">{periodLabel}</p>

      <div className="px-4 mb-3">
        <h2 className="text-xl font-bold mb-3">Categorías</h2>
        <div className="bg-dark-800 rounded-xl p-4">
          <p className="text-red-400 text-2xl font-extrabold">-{formatCurrency(totalSpent)}</p>
          <p className="text-dark-400 text-xs mt-0.5">Gastos totales</p>
        </div>
      </div>

      {catSpending.length > 0 && (
        <div className="px-4 mb-4">
          <div className="relative">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={65} outerRadius={110} paddingAngle={2} dataKey="value" stroke="none">
                  {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-lg font-bold">100%</p>
                <p className="text-[10px] text-dark-400">Total</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
            {catSpending.slice(0, 8).map(cat => (
              <div key={cat.id} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                <span className="text-[10px] text-dark-300">{cat.name} {cat.percentage.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4">
        {catSpending.map((cat) => {
          const hasSubs = cat.subcategories.length > 0;
          const isExpanded = expanded.has(cat.id);

          return (
            <div key={cat.id} className="border-b border-dark-800/50">
              {/* Parent row */}
              <div className="flex items-center gap-3.5 py-3.5">
                <button
                  onClick={() => openDrillDown(cat.id, cat.name, cat.icon, cat.color)}
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-lg flex-shrink-0 active:opacity-70 transition-opacity"
                  style={{ backgroundColor: cat.color }}
                >
                  {cat.icon}
                </button>

                <button
                  onClick={() => openDrillDown(cat.id, cat.name, cat.icon, cat.color)}
                  className="flex-1 min-w-0 text-left active:opacity-70 transition-opacity"
                >
                  <p className="text-[13px] font-semibold">{cat.name}</p>
                  <p className="text-[11px] text-dark-500 mt-0.5">
                    {cat.transactions} {cat.transactions === 1 ? 'transacción' : 'transacciones'}
                  </p>
                </button>

                <span className="text-[13px] font-bold text-red-400 flex-shrink-0">
                  -{formatCurrency(cat.spent)}
                </span>

                {hasSubs && (
                  <button onClick={() => toggleExpand(cat.id)} className="p-1 text-dark-500 hover:text-dark-300 transition-colors ml-1">
                    {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                )}
              </div>

              {/* Subcategories */}
              {hasSubs && isExpanded && (
                <div className="pb-2">
                  {cat.subcategories.map((sub, idx) => (
                    <button
                      key={sub.id}
                      onClick={() => openDrillDown(sub.id, sub.name, sub.icon, sub.color)}
                      className={`w-full flex items-center gap-3 pl-5 pr-2 py-2.5 active:bg-dark-800/40 transition-colors ${idx < cat.subcategories.length - 1 ? 'border-b border-dark-800/30' : ''}`}
                    >
                      <span className="text-dark-600 text-xs">└</span>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: sub.color }}>
                        {sub.icon}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-[12px] font-medium text-dark-200">{sub.name}</p>
                        <p className="text-[10px] text-dark-500">
                          {sub.transactions} {sub.transactions === 1 ? 'transacción' : 'transacciones'}
                        </p>
                      </div>
                      <span className="text-[12px] font-bold text-red-400 flex-shrink-0">
                        -{formatCurrency(sub.spent)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {catSpending.length === 0 && (
        <div className="text-center py-10">
          <div className="text-5xl mb-4">📊</div>
          <p className="text-dark-300 font-medium">No hay datos para este período</p>
        </div>
      )}
    </div>
  );
}
