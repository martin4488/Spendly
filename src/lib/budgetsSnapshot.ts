/**
 * budgetsSnapshot.ts
 *
 * La matemática de la pantalla de Presupuestos, fuera de React.
 *
 * Vive en su propio módulo por dos razones. Una: la calculan dos caminos —
 * `get_budgets_data`, que trae los períodos con el gasto ya sumado por Postgres,
 * y el respaldo del cliente, que los suma a mano cuando la RPC no está. Si esos
 * dos se separan, una RPC caída cambia los números en silencio (que es
 * exactamente cómo vivieron tres bugs en producción; ver src/lib/rpcFallback.ts).
 * Dos: acá se puede testear sin montar la vista — tests/budgets-snapshot.test.mjs.
 */

import { format } from 'date-fns';
import { es } from 'date-fns/locale';
// Ruta relativa y con extensión, no el alias `@/`: node --test carga este
// módulo directo (tests/budgets-snapshot.test.mjs) y no conoce ni los paths de
// tsconfig ni la resolución sin extensión de ESM.
import type { Budget, Category } from '../types/index.ts';
import { addMonthsStr, monthEndStr, parseLocalDate, todayStr } from './dateUtils.ts';

export interface BudgetPeriod {
  id: string;
  budget_id: string;
  period_start: string;
  period_end: string;
  /** `null`/ausente = el período hereda el monto del presupuesto. */
  amount?: number | null;
}

// ── Period generation ─────────────────────────────────────────────────────────
// Aritmética de strings, no de Date: 'yyyy-MM-dd' parseado como ISO es UTC, y en
// UTC-3 caía siempre en el mes anterior (ver src/lib/dateUtils.ts).
export function getPeriodBounds(startDate: string, recurrence: 'monthly' | 'yearly', offset: number = 0): { start: string; end: string } {
  if (recurrence === 'monthly') {
    const month = addMonthsStr(startDate.slice(0, 7), offset);
    return { start: `${month}-01`, end: monthEndStr(month) };
  }
  const year = Number(startDate.slice(0, 4)) + offset;
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function generateMissingPeriods(budget: Budget, existingPeriods: BudgetPeriod[]): { start: string; end: string }[] {
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

export interface BudgetsSnapshot {
  budgets: Budget[];
  currentPeriods: Record<string, BudgetPeriod>;
  globalStats: { spent: number; prevSpent: number } | null;
  monthlyBudget: number | null;
  globalAccumulated: number | null;
  globalAccumMonths: string;
}

/** Un período con su gasto ya sumado — la unidad con la que se arma la vista. */
export interface PeriodWithSpend {
  id: string;
  budget_id: string;
  period_start: string;
  period_end: string;
  amount: number | null;
  spent: number;
}

/** Una fila de `budgets` más las categorías que tiene asignadas. */
export type BudgetRow = Budget & { category_ids?: string[] };

const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const shortMonth = (d: string) => capitalize(format(parseLocalDate(d), 'MMM', { locale: es }));

/**
 * Le da forma a lo que muestra la pantalla. Es el único lugar donde vive esta
 * matemática: la reciben igual `get_budgets_data` (que trae los períodos con el
 * gasto ya sumado por Postgres) y el camino de respaldo (que los suma en el
 * cliente). Si las dos no coinciden acá, una RPC caída cambiaría los números en
 * silencio, que es justo lo que no queremos.
 *
 * @param periods       sólo los períodos vivos: el actual y los cerrados de este año
 * @param spentByMonth  gasto total por mes 'yyyy-MM' en lo que va del año
 */
export function buildSnapshot(
  allBudgets: BudgetRow[],
  periods: PeriodWithSpend[],
  globalPeriods: { month: string; amount: number }[],
  spentByMonth: Map<string, number>,
  catsMap: Map<string, Category>,
  today: string,
): BudgetsSnapshot {
  const curMonth = today.slice(0, 7);
  const yearStartStr = `${today.slice(0, 4)}-01-01`;

  const periodsByBudget = new Map<string, PeriodWithSpend[]>();
  for (const p of periods) {
    let arr = periodsByBudget.get(p.budget_id);
    if (!arr) { arr = []; periodsByBudget.set(p.budget_id, arr); }
    arr.push(p);
  }

  const curPeriods: Record<string, BudgetPeriod> = {};
  for (const b of allBudgets) {
    const cur = (periodsByBudget.get(b.id) || []).find(p => p.period_start <= today && p.period_end >= today);
    if (cur) curPeriods[b.id] = cur;
  }

  // ── Presupuesto global ──
  const globalStats = { spent: spentByMonth.get(curMonth) || 0, prevSpent: 0 };
  let monthlyBudget: number | null = null;
  let globalAccumulated: number | null = null;
  let globalAccumMonths = '';

  if (globalPeriods.length > 0) {
    // Un solo sort ascendente sirve para todo: el monto vigente de un mes es el
    // del último período con month <= mes.
    const sortedAsc = globalPeriods.slice().sort((a, b) => a.month.localeCompare(b.month));
    const exact = sortedAsc.find(p => p.month === curMonth);
    monthlyBudget = (exact || sortedAsc[sortedAsc.length - 1]).amount;

    const closedMonths: string[] = [];
    for (let m = 1; m <= 12; m++) {
      const mo = `${today.slice(0, 4)}-${String(m).padStart(2, '0')}`;
      if (mo >= curMonth) break;
      closedMonths.push(mo);
    }

    // `closedMonths` va en orden ascendente, así que un cursor alcanza.
    let cursor = 0;
    let carried: number | null = null;
    let acc = 0;
    const counted: string[] = [];
    for (const mo of closedMonths) {
      while (cursor < sortedAsc.length && sortedAsc[cursor].month <= mo) carried = sortedAsc[cursor++].amount;
      if (carried == null) continue;
      acc += carried - (spentByMonth.get(mo) || 0);
      counted.push(mo);
    }
    // Sólo se muestra si quedó en rojo.
    if (acc < 0 && counted.length > 0) {
      globalAccumulated = acc;
      const first = shortMonth(counted[0]);
      const last = shortMonth(counted[counted.length - 1]);
      globalAccumMonths = first === last ? first : `${first} - ${last}`;
    }
  }

  // ── Cada presupuesto ──
  const enriched: Budget[] = allBudgets.map(b => {
    const catIds = b.category_ids || [];
    const bCats = catIds.map(id => catsMap.get(id)).filter((c): c is Category => !!c);
    const curPeriod = curPeriods[b.id];

    const spent = curPeriod ? (curPeriod as PeriodWithSpend).spent : 0;

    // Excedente arrastrado: los períodos de este año ya cerrados, sólo mensuales.
    let prevAccumulated: number | null = null;
    let prevAccumMonths = '';
    if (b.recurrence === 'monthly' && curPeriod) {
      const prev = (periodsByBudget.get(b.id) || [])
        .filter(p => p.period_end < curPeriod.period_start && p.period_start >= yearStartStr)
        .sort((x, y) => x.period_start.localeCompare(y.period_start));
      if (prev.length > 0) {
        prevAccumulated = prev.reduce((sum, p) => sum + ((p.amount ?? b.amount) - p.spent), 0);
        const first = shortMonth(prev[0].period_start);
        const last = shortMonth(prev[prev.length - 1].period_start);
        prevAccumMonths = first === last ? first : `${first} - ${last}`;
      }
    }

    const currentAmount = curPeriod?.amount ?? b.amount;
    return { ...b, currentAmount, category_ids: catIds, categories: bCats, spent, prevAccumulated, prevAccumMonths } as any;
  });

  const sorted = enriched.slice().sort((a, b) => {
    if (a.recurrence !== b.recurrence) return a.recurrence === 'monthly' ? -1 : 1;
    const pctA = (a as any).currentAmount > 0 ? (a.spent || 0) / (a as any).currentAmount : 0;
    const pctB = (b as any).currentAmount > 0 ? (b.spent || 0) / (b as any).currentAmount : 0;
    return pctB - pctA;
  });

  return { budgets: sorted, currentPeriods: curPeriods, globalStats, monthlyBudget, globalAccumulated, globalAccumMonths };
}

