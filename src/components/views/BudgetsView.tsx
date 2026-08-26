'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { User } from '@supabase/auth-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Budget, Category } from '@/types';
import { Plus, X, ChevronRight, Delete, ArrowLeft, Search, Check } from 'lucide-react';
import CategoryIcon from '@/components/ui/CategoryIcon';
import { getIconEmoji } from '@/lib/iconMap';
import Amount from '@/components/ui/Amount';
import { format, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  addMonthsStr, currentMonthStr, monthEndStr, monthRange,
  parseLocalDate, todayStr, toMonthStr,
} from '@/lib/dateUtils';

interface Props {
  user: User;
  onOpenBudget: (budget: Budget, periodId?: string) => void;
  onOpenGlobalBudget: () => void;
}

export interface BudgetPeriod {
  id: string;
  budget_id: string;
  period_start: string;
  period_end: string;
  amount?: number;
}

import { CatNode, buildTree, flattenTree, allDescendantIds } from '@/lib/categoryTree';
import { getCategories, getCategoriesSync } from '@/lib/categoryCache';
import { useSyncOnForeground } from '@/lib/useSyncOnForeground';
import { toast } from '@/lib/toast';
import { confirmDialog } from '@/lib/confirm';
import OfflineState from '@/components/ui/OfflineState';
import { readViewCache, writeViewCache, isViewCacheFresh } from '@/lib/viewCache';

// ── Period generation ─────────────────────────────────────────────────────────
// Aritmética de strings, no de Date: 'yyyy-MM-dd' parseado como ISO es UTC, y en
// UTC-3 caía siempre en el mes anterior (ver src/lib/dateUtils.ts).
function getPeriodBounds(startDate: string, recurrence: 'monthly' | 'yearly', offset: number = 0): { start: string; end: string } {
  if (recurrence === 'monthly') {
    const month = addMonthsStr(startDate.slice(0, 7), offset);
    return { start: `${month}-01`, end: monthEndStr(month) };
  }
  const year = Number(startDate.slice(0, 4)) + offset;
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function generateMissingPeriods(budget: Budget, existingPeriods: BudgetPeriod[]): { start: string; end: string }[] {
  const today = todayStr();
  // O(1) lookups instead of .some() per iteration
  const existingStarts = new Set(existingPeriods.filter(p => p.budget_id === budget.id).map(p => p.period_start));
  const missing: { start: string; end: string }[] = [];
  let offset = 0;
  while (true) {
    const bounds = getPeriodBounds(budget.start_date, budget.recurrence as 'monthly' | 'yearly', offset);
    if (bounds.start > today) break;
    if (!existingStarts.has(bounds.start)) missing.push(bounds);
    offset++;
    if (offset > 120) break;
  }
  return missing;
}

// ── Snapshot cache ────────────────────────────────────────────────────────────
const BUDGETS_CACHE = 'budgets';
interface BudgetsSnapshot {
  budgets: Budget[];
  currentPeriods: Record<string, BudgetPeriod>;
  globalStats: { spent: number; prevSpent: number } | null;
  monthlyBudget: number | null;
  globalAccumulated: number | null;
  globalAccumMonths: string;
}

/**
 * Fetch + compute the full Budgets snapshot with no React state. Shared by the
 * component (interactive load) and the boot prefetch. Returns null when offline
 * or on error so the caller can decide whether to show the offline state.
 */
async function fetchBudgetsSnapshot(userId: string): Promise<BudgetsSnapshot | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  const today = todayStr();

  const [{ data: budgetsData, error: budgetsError }, catsMap] = await Promise.all([
    supabase.from('budgets').select('*').eq('user_id', userId).order('name'),
    getCategories(userId),
  ]);
  if (budgetsError) return null;

  const budgetIds = (budgetsData || []).map((b: any) => b.id);

  const [{ data: bcData }, { data: periodsData }] = budgetIds.length > 0
    ? await Promise.all([
        supabase.from('budget_category_periods').select('budget_id, category_id').in('budget_id', budgetIds).is('valid_to', null),
        supabase.from('budget_periods').select('id, budget_id, period_start, period_end, amount').in('budget_id', budgetIds),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }];

  const allBudgets = budgetsData || [];
  const allPeriods = periodsData || [];

  // Índice padre → hijos, construido una sola vez. Antes cada presupuesto
  // recorría el árbol entero y por cada nodo que le pertenecía volvía a recorrer
  // su subárbol completo (O(presupuestos × categorías²)); ahora es un BFS por
  // presupuesto que toca cada descendiente una vez.
  const childrenByParent = new Map<string, string[]>();
  for (const c of catsMap.values()) {
    if (!c.parent_id) continue;
    let arr = childrenByParent.get(c.parent_id);
    if (!arr) { arr = []; childrenByParent.set(c.parent_id, arr); }
    arr.push(c.id);
  }
  const expandWithDescendants = (seedIds: string[]): Set<string> => {
    const out = new Set<string>(seedIds);
    const stack = seedIds.slice();
    while (stack.length > 0) {
      const kids = childrenByParent.get(stack.pop()!);
      if (!kids) continue;
      for (const k of kids) if (!out.has(k)) { out.add(k); stack.push(k); }
    }
    return out;
  };

  // Group budget→categories and budget→periods in single passes
  const bcByBudget = new Map<string, string[]>();
  for (const bc of (bcData || []) as any[]) {
    let arr = bcByBudget.get(bc.budget_id);
    if (!arr) { arr = []; bcByBudget.set(bc.budget_id, arr); }
    arr.push(bc.category_id);
  }
  const periodsByBudget = new Map<string, BudgetPeriod[]>();
  for (const p of allPeriods as BudgetPeriod[]) {
    let arr = periodsByBudget.get(p.budget_id);
    if (!arr) { arr = []; periodsByBudget.set(p.budget_id, arr); }
    arr.push(p);
  }

  // Build missing-period inserts (auto-generate up to today)
  const missingInserts: { budget_id: string; period_start: string; period_end: string; amount?: number }[] = [];
  for (const b of allBudgets) {
    // El monto del período más reciente que tenga uno — un solo barrido en vez
    // de copiar y ordenar el array entero por presupuesto.
    let lastAmount: number | null = null;
    let lastStart = '';
    for (const p of periodsByBudget.get(b.id) || []) {
      if (p.amount != null && p.period_start > lastStart) { lastStart = p.period_start; lastAmount = p.amount; }
    }
    for (const m of generateMissingPeriods(b as Budget, periodsByBudget.get(b.id) || [])) {
      const insert: { budget_id: string; period_start: string; period_end: string; amount?: number } = {
        budget_id: b.id, period_start: m.start, period_end: m.end,
      };
      if (lastAmount != null) insert.amount = lastAmount;
      missingInserts.push(insert);
    }
  }
  if (missingInserts.length > 0) {
    const { data: newPeriods } = await supabase.from('budget_periods').insert(missingInserts).select();
    if (newPeriods) {
      for (const p of newPeriods as BudgetPeriod[]) {
        let arr = periodsByBudget.get(p.budget_id);
        if (!arr) { arr = []; periodsByBudget.set(p.budget_id, arr); }
        arr.push(p);
      }
    }
  }

  const curPeriods: Record<string, BudgetPeriod> = {};
  for (const b of allBudgets) {
    const cur = (periodsByBudget.get(b.id) || []).find(
      p => p.period_start <= today && p.period_end >= today
    );
    if (cur) curPeriods[b.id] = cur;
  }

  // Pre-build expanded-cat sets for each budget — un BFS por presupuesto
  const budgetCatSetMap = new Map<string, Set<string>>();
  for (const b of allBudgets) {
    budgetCatSetMap.set(b.id, expandWithDescendants(bcByBudget.get(b.id) || []));
  }

  // ── Global stats + accumulated ──
  const now2 = new Date();
  const curMonth2 = toMonthStr(now2);
  const yearStart = `${now2.getFullYear()}-01-01`;
  const curMonthStart = `${curMonth2}-01`;
  const curMonthEnd = monthEndStr(curMonth2);

  let globalStats: { spent: number; prevSpent: number } | null = null;
  let monthlyBudget: number | null = null;
  let globalAccumulated: number | null = null;
  let globalAccumMonths = '';

  // Per-budget spend needs the same round-trip depth as the global stats above —
  // both only depend on `budgetCatSetMap`, which is already built. Issuing them
  // in one wave instead of two saves a full round-trip on every Budgets load.
  // (They stay separate queries: the per-budget one reaches back to the earliest
  // budget start date but is category-filtered, while the global one is a
  // year-to-date scan. Merging them would widen one or the other.)
  const allExpandedCatIds = new Set<string>();
  for (const set of budgetCatSetMap.values()) {
    for (const id of set) allExpandedCatIds.add(id);
  }
  const globalMinDate = allBudgets.reduce((min, b) => b.start_date < min ? b.start_date : min, today);

  const [{ data: expRows }, { data: periods }, { data: budgetExpData }] = await Promise.all([
    supabase.from('expenses').select('amount, date').eq('user_id', userId).gte('date', yearStart).lte('date', curMonthEnd),
    supabase.from('global_budget_periods').select('month, amount').eq('user_id', userId),
    allExpandedCatIds.size > 0
      ? supabase
          .from('expenses')
          .select('category_id, amount, date')
          .eq('user_id', userId)
          .in('category_id', Array.from(allExpandedCatIds))
          .gte('date', globalMinDate)
          .lte('date', today)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  {
    const rows = expRows || [];
    let curSpent = 0;
    for (const e of rows) {
      if (e.date >= curMonthStart && e.date <= curMonthEnd) curSpent += Number(e.amount);
    }
    globalStats = { spent: curSpent, prevSpent: 0 };

    if (periods && periods.length > 0) {
      // Un solo sort ascendente sirve para todo: el monto vigente de cada mes es
      // el último período con month <= mes. Antes cada consulta hacía
      // find + filter + sort sobre el array completo.
      const sortedAsc = (periods as any[])
        .map(p => ({ month: p.month as string, amount: Number(p.amount) }))
        .sort((a, b) => a.month.localeCompare(b.month));
      const curPeriod = sortedAsc.find(p => p.month === curMonth2);
      const effectivePeriod = curPeriod || sortedAsc[sortedAsc.length - 1];
      if (effectivePeriod) monthlyBudget = effectivePeriod.amount;

      let cursor = 0;
      let carried: number | null = null;
      /** Sólo válido si se llama con meses en orden ascendente. */
      const nextMonthAmount = (mo: string): number | null => {
        while (cursor < sortedAsc.length && sortedAsc[cursor].month <= mo) {
          carried = sortedAsc[cursor].amount;
          cursor++;
        }
        return carried;
      };

      const yearStr = String(now2.getFullYear());
      const closedMonthsList: string[] = [];
      for (let m = 1; m <= 12; m++) {
        const mo = `${yearStr}-${String(m).padStart(2, '0')}`;
        if (mo >= curMonth2) break;
        closedMonthsList.push(mo);
      }

      if (closedMonthsList.length > 0) {
        const spentByMonth = new Map<string, number>();
        for (const e of rows) {
          const mo = e.date.slice(0, 7);
          spentByMonth.set(mo, (spentByMonth.get(mo) || 0) + Number(e.amount));
        }
        let acc = 0;
        let countedMonths: string[] = [];
        for (const mo of closedMonthsList) {
          const amt = nextMonthAmount(mo);
          if (amt == null) continue;
          acc += amt - (spentByMonth.get(mo) || 0);
          countedMonths.push(mo);
        }
        if (acc < 0 && countedMonths.length > 0) {
          globalAccumulated = acc;
          const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
          const first = cap(format(parseLocalDate(countedMonths[0]), 'MMM', { locale: es }));
          const last = cap(format(parseLocalDate(countedMonths[countedMonths.length - 1]), 'MMM', { locale: es }));
          globalAccumMonths = first === last ? first : `${first} - ${last}`;
        }
      }
    }
  }

  // ── Budget expenses → spent per budget ──
  // (fetched above, in the same wave as the global stats)
  const expByCat = new Map<string, { amount: number; date: string }[]>();
  for (const e of (budgetExpData || []) as any[]) {
    let arr = expByCat.get(e.category_id);
    if (!arr) { arr = []; expByCat.set(e.category_id, arr); }
    arr.push({ amount: Number(e.amount), date: e.date });
  }

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
  const yearStartStr = `${now2.getFullYear()}-01-01`;

  const enriched: Budget[] = allBudgets.map(b => {
    const catIds = bcByBudget.get(b.id) || [];
    const bCats = catIds.map(id => catsMap.get(id)).filter((c): c is Category => !!c);
    const expandedSet = budgetCatSetMap.get(b.id) || new Set<string>();
    const curPeriod = curPeriods[b.id];

    // Períodos a sumar: el actual + (si es mensual) los ya cerrados del año, que
    // alimentan el acumulado. Ordenados por inicio para poder ubicar cada gasto
    // con una búsqueda binaria.
    //
    // Antes esto recorría *todos* los gastos de *cada* categoría una vez por
    // período — O(períodos × categorías × gastos). Ahora cada gasto del
    // presupuesto se toca una sola vez: O(gastos × log períodos).
    const buckets: { start: string; end: string; amount: number; spent: number }[] = [];
    if (curPeriod) {
      if (b.recurrence === 'monthly') {
        for (const p of periodsByBudget.get(b.id) || []) {
          if (p.period_end < curPeriod.period_start && p.period_start >= yearStartStr) {
            buckets.push({ start: p.period_start, end: p.period_end, amount: p.amount ?? b.amount, spent: 0 });
          }
        }
      }
      buckets.push({ start: curPeriod.period_start, end: curPeriod.period_end, amount: curPeriod.amount ?? b.amount, spent: 0 });
      buckets.sort((x, y) => x.start.localeCompare(y.start));
    }
    const curIndex = buckets.length - 1; // el actual es siempre el más reciente

    if (buckets.length > 0 && expandedSet.size > 0) {
      for (const catId of expandedSet) {
        const list = expByCat.get(catId);
        if (!list) continue;
        for (const e of list) {
          // Último bucket cuyo inicio es <= la fecha del gasto.
          let lo = 0, hi = buckets.length - 1, found = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (buckets[mid].start <= e.date) { found = mid; lo = mid + 1; }
            else hi = mid - 1;
          }
          if (found >= 0 && e.date <= buckets[found].end) buckets[found].spent += e.amount;
        }
      }
    }

    const spent = curIndex >= 0 ? buckets[curIndex].spent : 0;

    let prevAccumulated: number | null = null;
    let prevAccumMonths = '';
    if (b.recurrence === 'monthly' && curIndex > 0 && expandedSet.size > 0) {
      let acc = 0;
      for (let i = 0; i < curIndex; i++) acc += buckets[i].amount - buckets[i].spent;
      prevAccumulated = acc;
      const fmt = (d: string) => capitalize(format(parseLocalDate(d), 'MMM', { locale: es }));
      const first = fmt(buckets[0].start);
      const last = fmt(buckets[curIndex - 1].start);
      prevAccumMonths = first === last ? first : `${first} - ${last}`;
    }

    const currentAmount = curPeriod?.amount ?? b.amount;
    return { ...b, currentAmount, category_ids: catIds, categories: bCats, spent, prevAccumulated, prevAccumMonths } as any;
  });

  const sorted = enriched.slice().sort((a, b) => {
    if (a.recurrence !== b.recurrence)
      return a.recurrence === 'monthly' ? -1 : 1;
    const pctA = (a as any).currentAmount > 0 ? (a.spent || 0) / (a as any).currentAmount : 0;
    const pctB = (b as any).currentAmount > 0 ? (b.spent || 0) / (b as any).currentAmount : 0;
    return pctB - pctA;
  });

  return { budgets: sorted, currentPeriods: curPeriods, globalStats, monthlyBudget, globalAccumulated, globalAccumMonths };
}

// Warm the Budgets snapshot during boot idle → instant first visit.
export async function prefetchBudgets(userId: string): Promise<void> {
  try {
    const snap = await fetchBudgetsSnapshot(userId);
    if (snap) writeViewCache<BudgetsSnapshot>(BUDGETS_CACHE, userId, snap);
  } catch { /* offline / error — leave any existing snapshot untouched */ }
}

export default function BudgetsView({ user, onOpenBudget, onOpenGlobalBudget }: Props) {
  // Stale-while-revalidate: hydrate from the last snapshot (categories/tree come
  // from the in-memory category cache seeded at boot) so repeat and prefetched
  // first visits render instantly, no spinner.
  const cached = useMemo(() => readViewCache<BudgetsSnapshot>(BUDGETS_CACHE, user.id), [user.id]);
  const cachedCats = useMemo(() => getCategoriesSync(user.id), [user.id]);

  const [budgets, setBudgets] = useState<Budget[]>(cached?.budgets || []);
  const [categoriesById, setCategoriesById] = useState<Map<string, Category>>(cachedCats || new Map());
  const [roots, setRoots] = useState<CatNode[]>(cachedCats ? buildTree(Array.from(cachedCats.values())) : []);
  const [loading, setLoading] = useState(!cached);
  const [offline, setOffline] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [currentPeriods, setCurrentPeriods] = useState<Record<string, BudgetPeriod>>(cached?.currentPeriods || {});
  const [monthlyBudget, setMonthlyBudget] = useState<number | null>(cached?.monthlyBudget ?? null);
  const [globalStats, setGlobalStats] = useState<{ spent: number; prevSpent: number } | null>(cached?.globalStats ?? null);
  const [globalAccumulated, setGlobalAccumulated] = useState<number | null>(cached?.globalAccumulated ?? null);
  const [globalAccumMonths, setGlobalAccumMonths] = useState<string>(cached?.globalAccumMonths || '');
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetStartMonth, setBudgetStartMonth] = useState(format(startOfMonth(new Date()), 'yyyy-MM'));

  // Form state — keep selectedCatIds as Set for O(1) toggle/has
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [recurrence, setRecurrence] = useState<'monthly' | 'yearly'>('monthly');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(new Set());
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  function handleNumpad(key: string) {
    if (key === 'backspace') { setAmount(prev => prev.slice(0, -1)); }
    else if (key === '.') { if (!amount.includes('.')) setAmount(prev => (prev || '0') + '.'); }
    else {
      if (amount.includes('.')) { const d = amount.split('.')[1]; if (d && d.length >= 2) return; }
      setAmount(prev => prev + key);
    }
  }

  // The boot warm-up (AppShell) usually prefetched this snapshot moments ago —
  // refetching it again on first open just doubled the request count for nothing.
  useEffect(() => {
    if (cached && isViewCacheFresh(BUDGETS_CACHE, user.id)) return;
    loadData(!!cached);
  }, []);

  // Refresh budget spend across devices when the app returns to the foreground
  // or a realtime expense change lands. Silent (no spinner) so the list doesn't flash.
  useSyncOnForeground(user.id, () => loadData(true));

  async function loadData(silent = false) {
    if (!silent) setLoading(true);
    try {
      const snap = await fetchBudgetsSnapshot(user.id);
      if (!snap) {
        // Offline or error: keep whatever's on screen; only surface the offline
        // state on an explicit (non-silent) load so a background sync never flashes it.
        if (!silent) { setOffline(true); setLoading(false); }
        return;
      }
      setOffline(false);
      const catsMap = getCategoriesSync(user.id);
      if (catsMap) { setCategoriesById(catsMap); setRoots(buildTree(Array.from(catsMap.values()))); }
      setBudgets(snap.budgets);
      setCurrentPeriods(snap.currentPeriods);
      setGlobalStats(snap.globalStats);
      setMonthlyBudget(snap.monthlyBudget);
      setGlobalAccumulated(snap.globalAccumulated);
      setGlobalAccumMonths(snap.globalAccumMonths);
      setLoading(false);
      writeViewCache<BudgetsSnapshot>(BUDGETS_CACHE, user.id, snap);
    } catch (err) { console.error(err); if (!silent) setLoading(false); }
  }

  function openForm(budget?: Budget) {
    if (budget) {
      setEditingBudget(budget); setName(budget.name); setAmount(String(budget.amount));
      setRecurrence(budget.recurrence as 'monthly' | 'yearly'); setStartDate(budget.start_date);
      setSelectedCatIds(new Set(budget.category_ids || []));
    } else {
      setEditingBudget(null); setName(''); setAmount('');
      setRecurrence('monthly');
      setStartDate(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
      setSelectedCatIds(new Set());
    }
    setShowForm(true);
  }

  async function handleSave() {
    if (!name || !amount) return;
    setSaving(true);
    try {
      const newAmount = parseFloat(amount);
      const budgetData = { user_id: user.id, name, amount: newAmount, recurrence, start_date: startDate };
      let budgetId: string;
      const today = format(new Date(), 'yyyy-MM-dd');
      if (editingBudget) {
        await supabase.from('budgets').update(budgetData).eq('id', editingBudget.id);
        budgetId = editingBudget.id;
        const { data: futurePeriods } = await supabase
          .from('budget_periods').select('id, amount').eq('budget_id', budgetId).gte('period_start', today);
        if (futurePeriods && futurePeriods.length > 0) {
          const toUpdate = (futurePeriods as any[])
            .filter(p => p.amount == null || p.amount === editingBudget.amount)
            .map(p => p.id);
          if (toUpdate.length > 0)
            await supabase.from('budget_periods').update({ amount: newAmount }).in('id', toUpdate);
        }
      } else {
        const { data } = await supabase.from('budgets').insert(budgetData).select().single();
        budgetId = data.id;
        if (selectedCatIds.size > 0) {
          await supabase.from('budget_category_periods').insert(
            Array.from(selectedCatIds).map(cid => ({ budget_id: budgetId, category_id: cid, valid_from: startDate, valid_to: null }))
          );
        }
      }
      setShowForm(false);
      loadData();
    } catch (err) {
      console.error(err);
      toast('No se pudo guardar el presupuesto. Reintentá.');
    }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!(await confirmDialog('¿Eliminar este presupuesto?'))) return;
    const { error } = await supabase.from('budgets').delete().eq('id', id);
    if (error) { toast('No se pudo eliminar el presupuesto. Reintentá.'); return; }
    loadData();
  }

  // O(1) per toggle now that selectedCatIds is a Set
  const toggleLeaf = useCallback((catId: string) => {
    setSelectedCatIds(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }, []);

  const toggleRoot = useCallback((root: CatNode) => {
    const ids = allDescendantIds(root);
    setSelectedCatIds(prev => {
      const next = new Set(prev);
      const allSel = ids.every(id => next.has(id));
      if (allSel) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  function isRootFullySelected(root: CatNode) {
    const ids = allDescendantIds(root);
    for (const id of ids) if (!selectedCatIds.has(id)) return false;
    return true;
  }
  function isRootPartiallySelected(root: CatNode) {
    const ids = allDescendantIds(root);
    let some = false, all = true;
    for (const id of ids) {
      if (selectedCatIds.has(id)) some = true; else all = false;
    }
    return some && !all;
  }

  async function saveMonthlyBudget() {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val <= 0) return;
    // Ojo: esto era `format(addMonths(new Date(`${m}-01`), 1), 'yyyy-MM')`. Con
    // offset UTC negativo el string se parseaba como el mes anterior y volvía al
    // mismo mes al formatear → `m` nunca avanzaba y el while colgaba la pestaña.
    const months = monthRange(budgetStartMonth, currentMonthStr());
    const upserts = months.map(mo => ({ user_id: user.id, month: mo, amount: val }));
    const { error } = await supabase.from('global_budget_periods').upsert(upserts, { onConflict: 'user_id,month' });
    if (error) { toast('No se pudo guardar el presupuesto mensual. Reintentá.'); return; }
    setMonthlyBudget(val);
    setShowBudgetModal(false);
  }

  // ── Memoized derived data ──
  const allEntries = useMemo(() => flattenTree(roots), [roots]);

  const q = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(
    () => q ? allEntries.filter(e => e.cat.name.toLowerCase().includes(q)) : [],
    [allEntries, q]
  );

  const selectedLabel = useMemo(() => {
    if (selectedCatIds.size === 0) return '';
    const parts: string[] = [];
    for (const r of roots) {
      const ids = allDescendantIds(r);
      const allSel = ids.every(id => selectedCatIds.has(id));
      if (allSel) {
        parts.push(`${getIconEmoji(r.icon)} ${r.name} (todo)`);
      } else {
        for (const id of ids) {
          if (!selectedCatIds.has(id)) continue;
          const c = categoriesById.get(id);
          if (c) parts.push(`${getIconEmoji(c.icon)} ${c.name}`);
        }
      }
    }
    return parts.join(', ');
  }, [selectedCatIds, roots, categoriesById]);

  const recurrenceLabels: Record<string, string> = { monthly: 'Mensual', yearly: 'Anual' };

  if (offline) return <OfflineState onRetry={() => loadData()} />;

  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto page-transition">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Presupuestos</h1>
        <button onClick={() => openForm()}
          className="bg-brand-600 hover:bg-brand-500 text-white p-2.5 rounded-xl transition-colors shadow-lg shadow-brand-600/20">
          <Plus size={18} />
        </button>
      </div>

      {/* GLOBAL BUDGET WIDGET */}
      {(() => {
        const now = new Date();
        const spent = globalStats?.spent || 0;
        const pct = monthlyBudget && monthlyBudget > 0 ? (spent / monthlyBudget) * 100 : 0;
        const left = monthlyBudget ? Math.max(monthlyBudget - spent, 0) : 0;
        const isOver = monthlyBudget ? spent > monthlyBudget : false;
        const color = isOver ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#22c55e';
        const textColor = isOver ? 'text-red-400' : pct >= 80 ? 'text-amber-400' : 'text-brand-400';
        const monthLabel = format(now, 'MMMM', { locale: es });
        const availablePct = Math.max(100 - pct, 0);
        const overAmount = isOver ? spent - (monthlyBudget || 0) : 0;

        return (
          <button onClick={onOpenGlobalBudget} className="w-full text-left mb-4">
            <div className="rounded-2xl p-4" style={{ background: '#0a2540', border: '1px solid #1d4ed820' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-dark-500 uppercase tracking-wider capitalize">Gasto global · {monthLabel}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#22c55e18', color: '#22c55e' }}>GLOBAL</span>
              </div>

              {monthlyBudget ? (
                <>
                  <div className="flex items-end justify-between mb-2.5">
                    <div>
                      <div className="text-sm font-bold text-dark-300">
                        <Amount value={spent} size="sm" color="text-dark-300" weight="bold" decimals={false} />
                        {' / '}
                        <Amount value={monthlyBudget} size="sm" color="text-dark-300" weight="bold" decimals={false} />
                      </div>
                      <div className={`text-xs mt-0.5 ${isOver ? 'text-red-400' : 'text-dark-500'}`}>
                        {pct.toFixed(0)}% {isOver ? 'excedido' : 'gastado'}
                      </div>
                    </div>
                    <div className="text-right">
                      <Amount value={isOver ? overAmount : left} size="lg" color={textColor} weight="extrabold" decimals={false} />
                      <div className={`text-[11px] mt-0.5 ${textColor}`}>
                        {isOver ? 'excedido' : 'disponible'}
                      </div>
                    </div>
                  </div>
                  <div className="w-full rounded-full h-1.5 overflow-hidden relative" style={{ background: '#1e3a5f' }}>
                    {!isOver && (
                      <div className="absolute right-0 top-0 h-full rounded-full transition-all duration-500"
                        style={{ width: `${availablePct}%`, backgroundColor: color }} />
                    )}
                  </div>
                  {globalAccumulated !== null && globalAccumulated < 0 && (
                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                      <span className="text-[11px] font-medium text-red-400">
                        {formatCurrency(Math.abs(globalAccumulated), undefined, true)} excedido acumulado en {now.getFullYear()}{globalAccumMonths ? ` (${globalAccumMonths})` : ''}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <Amount value={spent} size="lg" color="text-dark-200" weight="extrabold" decimals={false} />
                    <span className="text-xs text-dark-500 ml-2">gastado este mes</span>
                  </div>
                  <span className="text-xs text-brand-400 font-medium">Configurar →</span>
                </div>
              )}
            </div>
          </button>
        );
      })()}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : budgets.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-5xl mb-4">💰</div>
          <p className="text-dark-300 font-medium">No tenés presupuestos</p>
          <p className="text-dark-500 text-sm mt-1">Creá uno para controlar tus gastos</p>
          <button onClick={() => openForm()}
            className="mt-5 bg-brand-600/15 text-brand-400 text-sm font-semibold px-6 py-3 rounded-2xl border border-brand-600/20">
            Crear presupuesto
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((budget) => {
            const spent = budget.spent || 0;
            const budgetAmount = (budget as any).currentAmount ?? budget.amount;
            const isOver = spent > budgetAmount;
            const left = isOver ? spent - budgetAmount : budgetAmount - spent;
            const pct = budgetAmount > 0 ? (spent / budgetAmount) * 100 : 0;
            const availablePct = Math.max(100 - pct, 0);
            const barColor = isOver ? null : pct >= 80 ? '#f59e0b' : '#22c55e';
            const valueColor = isOver ? 'text-red-400' : pct >= 80 ? 'text-amber-400' : 'text-brand-400';
            const curPeriod = currentPeriods[budget.id];

            return (
              <button key={budget.id}
                onClick={() => curPeriod && onOpenBudget(budget, curPeriod.id)}
                className="w-full bg-dark-800 rounded-2xl p-4 text-left transition-colors">

                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold">{budget.name}</h3>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-dark-500 capitalize">
                      {budget.recurrence === 'monthly' ? 'Mensual' : 'Anual'}
                    </span>
                    <ChevronRight size={14} className="text-dark-500" />
                  </div>
                </div>

                <div className="flex items-baseline justify-between mb-2.5">
                  <span className="text-xs text-dark-500">
                    <Amount value={spent} size="sm" color="text-dark-500" weight="medium" decimals={false} />
                    {' / '}
                    <Amount value={budgetAmount} size="sm" color="text-dark-500" weight="medium" decimals={false} />
                    {' · '}
                    <span className={isOver ? 'text-red-400' : 'text-dark-500'}>{pct.toFixed(0)}% gastado</span>
                  </span>
                  <div className="flex items-baseline gap-1">
                    <Amount value={left} size="lg" color={valueColor} weight="extrabold" decimals={false} />
                    <span className={`text-[11px] ${valueColor}`}>
                      {isOver ? 'excedido' : 'disponible'}
                    </span>
                  </div>
                </div>

                <div className="w-full bg-dark-700 rounded-full h-1.5 overflow-hidden relative">
                  {!isOver && barColor && (
                    <div
                      className="absolute right-0 top-0 h-full rounded-full transition-all duration-500"
                      style={{ width: `${availablePct}%`, backgroundColor: barColor }}
                    />
                  )}
                </div>

                {(budget as any).prevAccumulated !== null && (budget as any).prevAccumulated < 0 && (
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-red-500/10">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    <span className="text-[11px] text-red-400">
                      {formatCurrency(Math.abs((budget as any).prevAccumulated), undefined, true)} excedido acumulado en {new Date().getFullYear()}{(budget as any).prevAccumMonths ? ` (${(budget as any).prevAccumMonths})` : ''}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── FORM ── */}
      {showForm && !showCatPicker && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => setShowForm(false)} className="p-1 text-dark-400 hover:text-white"><X size={24} /></button>
            <h2 className="text-base font-bold">{editingBudget ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h2>
            {editingBudget ? (
              <button onClick={() => { handleDelete(editingBudget.id); setShowForm(false); }} className="p-1 text-red-400">🗑️</button>
            ) : <div className="w-8" />}
          </div>

          <div className="px-5 py-4 flex-shrink-0 border-b border-dark-800">
            <p className="text-xs text-dark-400 font-medium mb-1 uppercase tracking-wider">{editingBudget ? 'Monto a partir de este período' : 'Monto'}</p>
            <p className="text-3xl font-extrabold text-white">{amount || '0'}</p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Nombre</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg">💰</span>
                <input type="text" placeholder="Ej: Car, Groceries..." value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 pl-11 pr-4 text-sm placeholder:text-dark-500 focus:outline-none focus:border-brand-500 transition-colors" />
              </div>
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Recurrencia</label>
              <div className="flex bg-dark-800 rounded-xl p-1 border border-dark-700">
                {(['monthly', 'yearly'] as const).map((r) => (
                  <button key={r} onClick={() => setRecurrence(r)}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${recurrence === r ? 'bg-brand-600 text-white shadow-lg' : 'text-dark-400'}`}>
                    {recurrenceLabels[r]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">Fecha inicio</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors" />
            </div>

            <div>
              <label className="text-xs text-dark-400 font-medium mb-1.5 block uppercase tracking-wider">
                Categorías {selectedCatIds.size > 0 && `(${selectedCatIds.size})`}
              </label>
              <button onClick={() => setShowCatPicker(true)}
                className="w-full bg-dark-800 border border-dark-700 rounded-xl py-3.5 px-4 text-sm text-left flex items-center justify-between">
                <span className={`flex-1 min-w-0 truncate ${selectedCatIds.size > 0 ? 'text-white' : 'text-dark-500'}`}>
                  {selectedCatIds.size > 0 ? selectedLabel : 'Seleccionar categorías...'}
                </span>
                <ChevronRight size={16} className="text-dark-500 flex-shrink-0 ml-2" />
              </button>
            </div>
          </div>

          <div className="flex-shrink-0">
            <div className="px-5 py-3">
              <button onClick={handleSave} disabled={saving || !name || !amount}
                className="w-full bg-brand-600 disabled:opacity-30 text-white font-bold py-4 rounded-2xl text-base">
                {saving ? 'Guardando...' : editingBudget ? 'Guardar cambios' : 'Crear presupuesto'}
              </button>
            </div>
            <div className="border-t border-dark-700">
              <div className="grid grid-cols-3">
                {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map((key) => {
                  const isDel = key === 'backspace';
                  return (
                    <button key={key} onClick={() => isDel ? handleNumpad('backspace') : handleNumpad(key)}
                      className="py-[14px] text-center text-xl font-medium border-b border-r border-dark-800 active:bg-dark-700 transition-colors bg-dark-900 text-white">
                      {isDel ? <span className="flex items-center justify-center"><Delete size={22} /></span> : key}
                    </button>
                  );
                })}
              </div>
              <div className="h-[env(safe-area-inset-bottom)]" />
            </div>
          </div>
        </div>
      )}

      {/* ── CATEGORY PICKER ── */}
      {showForm && showCatPicker && (
        <div className="fixed inset-0 bg-dark-900 z-[70] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => { setShowCatPicker(false); setSearchQuery(''); }} className="p-1 text-dark-400 hover:text-white">
              <ArrowLeft size={24} />
            </button>
            <h2 className="text-base font-bold">Categorías del presupuesto</h2>
            <button onClick={() => { setShowCatPicker(false); setSearchQuery(''); }} className="text-xs text-brand-400 font-medium">
              Confirmar
            </button>
          </div>

          <div className="px-4 pb-3 flex-shrink-0">
            <div className="flex items-center gap-2 bg-dark-800 rounded-2xl px-4 py-3">
              <Search size={16} className="text-dark-400 flex-shrink-0" />
              <input type="text" placeholder="Buscar categorías" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm placeholder:text-dark-500 focus:outline-none" />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="text-dark-400"><X size={14} /></button>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pb-8">
            {q ? (
              searchResults.length === 0 ? (
                <div className="text-center py-10 text-dark-500 text-sm">Sin resultados</div>
              ) : (
                <div>
                  {searchResults.map(({ cat, ancestors }) => {
                    const isSelected = selectedCatIds.has(cat.id);
                    return (
                      <button key={cat.id} onClick={() => toggleLeaf(cat.id)}
                        className={`w-full flex items-center gap-3 px-5 py-3.5 border-b border-dark-800/60 transition-colors ${isSelected ? 'bg-dark-800' : 'active:bg-dark-800/60'}`}>
                        <CategoryIcon icon={cat.icon} color={cat.color} size={36} rounded="full" />
                        <div className="flex-1 text-left">
                          <p className="text-sm font-medium">{cat.name}</p>
                          {ancestors.length > 0 && <p className="text-xs text-dark-400">{ancestors.map(a => a.name).join(' › ')}</p>}
                        </div>
                        {isSelected && <Check size={18} className="text-brand-400 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              roots.map(root => {
                const childEntries = flattenTree(root.children, [root]);
                const fullySelected = isRootFullySelected(root);
                const partiallySelected = isRootPartiallySelected(root);
                return (
                  <div key={root.id} className="mb-6">
                    <button onClick={() => toggleRoot(root)}
                      className="w-full flex items-center justify-between px-4 pt-4 pb-2 active:opacity-70">
                      <span className="text-xs font-bold text-dark-400 uppercase tracking-wider">{root.name}</span>
                      <div className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${
                        fullySelected ? 'bg-brand-500 border-brand-500' :
                        partiallySelected ? 'bg-brand-500/30 border-brand-500/50' : 'border-dark-600'
                      }`}>
                        {fullySelected && <Check size={12} className="text-white" />}
                        {partiallySelected && !fullySelected && <div className="w-2 h-2 rounded-sm bg-brand-400" />}
                      </div>
                    </button>
                    {childEntries.length > 0 && (
                      <div className="grid grid-cols-4 gap-x-2 gap-y-4 px-4">
                        {childEntries.map(({ cat, ancestors }) => {
                          const isSelected = selectedCatIds.has(cat.id);
                          const depth = ancestors.length - 1;
                          const iconSize = depth === 0 ? 52 : depth === 1 ? 46 : 40;
                          return (
                            <button key={cat.id} onClick={() => toggleLeaf(cat.id)}
                              className="flex flex-col items-center gap-1.5 active:opacity-70">
                              <div className="rounded-full flex items-center justify-center flex-shrink-0 relative overflow-hidden"
                                style={{ width: iconSize, height: iconSize,
                                  boxShadow: isSelected ? `0 0 0 3px white, 0 0 0 5px ${cat.color}` : undefined }}>
                                <CategoryIcon icon={cat.icon} color={cat.color} size={iconSize} rounded="full" />
                                {isSelected && (
                                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-brand-500 flex items-center justify-center">
                                    <Check size={9} className="text-white" strokeWidth={3} />
                                  </div>
                                )}
                              </div>
                              <span className="text-center leading-tight text-dark-200 w-full"
                                style={{ fontSize: 11, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden', wordBreak: 'break-word' }}>
                                {cat.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* SET MONTHLY BUDGET MODAL */}
      {showBudgetModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
          <div className="bg-dark-900 w-full max-w-lg rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold">Presupuesto mensual global</h3>
              <button onClick={() => setShowBudgetModal(false)} className="text-dark-400 p-1"><X size={20} /></button>
            </div>
            <p className="text-xs text-dark-500 mb-3">¿Cuánto querés gastar como máximo por mes en total?</p>
            <div className="flex items-center gap-3 mb-3">
              <label className="text-xs text-dark-400 whitespace-nowrap">Desde</label>
              <input type="month" value={budgetStartMonth} onChange={e => setBudgetStartMonth(e.target.value)}
                max={format(new Date(), 'yyyy-MM')}
                className="flex-1 bg-dark-800 border border-dark-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-dark-500" />
            </div>
            <div className="bg-dark-800 rounded-2xl px-4 py-3 text-center mb-4">
              <span className="text-3xl font-extrabold">{budgetInput || '0'}</span>
            </div>
            <div className="grid grid-cols-3 border-t border-dark-800">
              {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map(key => (
                <button key={key}
                  onClick={() => {
                    if (key === 'backspace') setBudgetInput(p => p.slice(0, -1));
                    else if (key === '.') { if (!budgetInput.includes('.')) setBudgetInput(p => (p || '0') + '.'); }
                    else { if (budgetInput.includes('.')) { const [,d] = budgetInput.split('.'); if ((d?.length || 0) >= 2) return; } setBudgetInput(p => p + key); }
                  }}
                  className="py-4 text-center text-xl font-medium border-b border-r border-dark-800 active:bg-dark-700 bg-dark-900 text-white">
                  {key === 'backspace' ? <span className="flex items-center justify-center"><Delete size={20} /></span> : key}
                </button>
              ))}
            </div>
            <button onClick={saveMonthlyBudget}
              disabled={!budgetInput || isNaN(parseFloat(budgetInput))}
              className="w-full mt-4 bg-brand-600 disabled:opacity-30 text-white font-bold py-4 rounded-2xl text-base">
              Guardar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
