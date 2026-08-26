/**
 * La matemática de la pantalla de Presupuestos.
 *
 * `buildSnapshot()` la calculan dos caminos: `get_budgets_data`, que trae los
 * períodos con el gasto ya sumado por Postgres, y el respaldo del cliente, que
 * los suma a mano. Los dos entran por acá, así que si esto está bien los dos
 * muestran lo mismo — y una RPC caída no cambia los números en silencio.
 *
 * No necesita red ni credenciales.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSnapshot, getPeriodBounds } from '../src/lib/budgetsSnapshot.ts';

const TODAY = '2026-08-26'; // agosto de 2026, para que enero–julio estén cerrados

const catsMap = new Map([
  ['cat-comida', { id: 'cat-comida', name: 'Comida', icon: 'utensils', color: '#f00', parent_id: null }],
  ['cat-super',  { id: 'cat-super',  name: 'Súper',  icon: 'cart',     color: '#f50', parent_id: 'cat-comida' }],
]);

const mensual = {
  id: 'b1', user_id: 'u1', name: 'Comida', amount: 100, currency: 'ARS',
  recurrence: 'monthly', start_date: '2026-06-01', category_ids: ['cat-comida'],
};

/** Un período del mes `mo` con su gasto. */
const per = (budget_id, mo, spent, amount = null) => ({
  id: `${budget_id}-${mo}`, budget_id,
  period_start: `${mo}-01`,
  period_end: `${mo}-${new Date(Number(mo.slice(0, 4)), Number(mo.slice(5, 7)), 0).getDate()}`,
  amount, spent,
});

test('el gasto del presupuesto es el del período que corre hoy', () => {
  const snap = buildSnapshot(
    [mensual],
    [per('b1', '2026-06', 80), per('b1', '2026-07', 90), per('b1', '2026-08', 42)],
    [], new Map(), catsMap, TODAY,
  );
  assert.equal(snap.budgets[0].spent, 42);
  assert.equal(snap.currentPeriods['b1'].period_start, '2026-08-01');
  // Sin monto propio, el período hereda el del presupuesto.
  assert.equal(snap.budgets[0].currentAmount, 100);
});

test('el monto del período pisa al del presupuesto', () => {
  const snap = buildSnapshot([mensual], [per('b1', '2026-08', 42, 250)], [], new Map(), catsMap, TODAY);
  assert.equal(snap.budgets[0].currentAmount, 250);
});

test('el acumulado suma los períodos cerrados de este año, no el actual', () => {
  const snap = buildSnapshot(
    [mensual],
    // junio gastó 130 sobre 100 (−30), julio 60 sobre 100 (+40), agosto va en curso
    [per('b1', '2026-06', 130), per('b1', '2026-07', 60), per('b1', '2026-08', 42)],
    [], new Map(), catsMap, TODAY,
  );
  assert.equal(snap.budgets[0].prevAccumulated, 10);   // −30 + 40
  assert.equal(snap.budgets[0].prevAccumMonths, 'Jun - Jul');
});

test('un solo mes cerrado no muestra un rango', () => {
  const snap = buildSnapshot(
    [mensual], [per('b1', '2026-07', 60), per('b1', '2026-08', 42)],
    [], new Map(), catsMap, TODAY,
  );
  assert.equal(snap.budgets[0].prevAccumMonths, 'Jul');
});

test('los presupuestos anuales no acumulan', () => {
  const anual = { ...mensual, id: 'b2', recurrence: 'yearly', start_date: '2025-01-01' };
  const snap = buildSnapshot(
    [anual],
    [{ id: 'p', budget_id: 'b2', period_start: '2026-01-01', period_end: '2026-12-31', amount: 1200, spent: 500 }],
    [], new Map(), catsMap, TODAY,
  );
  assert.equal(snap.budgets[0].prevAccumulated, null);
  assert.equal(snap.budgets[0].spent, 500);
});

test('un presupuesto sin período vigente no rompe ni inventa gasto', () => {
  // Arranca el mes que viene: no hay período que contenga a hoy.
  const futuro = { ...mensual, start_date: '2026-09-01' };
  const snap = buildSnapshot([futuro], [], [], new Map(), catsMap, TODAY);
  assert.equal(snap.budgets[0].spent, 0);
  assert.equal(snap.currentPeriods['b1'], undefined);
  assert.equal(snap.budgets[0].prevAccumulated, null);
});

test('las categorías asignadas se resuelven contra el caché', () => {
  const snap = buildSnapshot(
    [{ ...mensual, category_ids: ['cat-comida', 'cat-super', 'cat-borrada'] }],
    [per('b1', '2026-08', 0)], [], new Map(), catsMap, TODAY,
  );
  // La que no está en el caché se descarta, pero el id se conserva.
  assert.deepEqual(snap.budgets[0].categories.map(c => c.name), ['Comida', 'Súper']);
  assert.equal(snap.budgets[0].category_ids.length, 3);
});

test('la lista ordena mensuales primero y por porcentaje gastado', () => {
  const a = { ...mensual, id: 'a', name: 'A', amount: 100 };
  const b = { ...mensual, id: 'b', name: 'B', amount: 100 };
  const anual = { ...mensual, id: 'y', name: 'Y', recurrence: 'yearly', amount: 100 };
  const snap = buildSnapshot(
    [a, b, anual],
    [per('a', '2026-08', 10), per('b', '2026-08', 90),
     { id: 'yp', budget_id: 'y', period_start: '2026-01-01', period_end: '2026-12-31', amount: 100, spent: 99 }],
    [], new Map(), catsMap, TODAY,
  );
  assert.deepEqual(snap.budgets.map(x => x.id), ['b', 'a', 'y']);
});

// ── Presupuesto global ───────────────────────────────────────────────────────

test('el gasto global del mes sale de los totales mensuales', () => {
  const snap = buildSnapshot([], [], [{ month: '2026-08', amount: 1000 }],
    new Map([['2026-07', 900], ['2026-08', 640]]), catsMap, TODAY);
  assert.equal(snap.globalStats.spent, 640);
  assert.equal(snap.monthlyBudget, 1000);
});

test('un mes sin monto propio hereda el del último mes que lo tenga', () => {
  // Se fijó 800 en junio y nunca más. Julio y agosto valen 800 igual.
  const snap = buildSnapshot([], [], [{ month: '2026-06', amount: 800 }],
    new Map([['2026-06', 900], ['2026-07', 1000]]), catsMap, TODAY);
  assert.equal(snap.monthlyBudget, 800);               // agosto hereda junio
  // Junio se pasó 100 y julio 200; enero–mayo no cuentan (no había monto).
  assert.equal(snap.globalAccumulated, -300);
  assert.equal(snap.globalAccumMonths, 'Jun - Jul');
});

test('un mes cerrado con saldo a favor compensa a uno excedido', () => {
  // Es lo que hace hoy: el acumulado es la suma neta, no sólo los rojos.
  const snap = buildSnapshot([], [], [{ month: '2026-06', amount: 800 }],
    new Map([['2026-06', 300], ['2026-07', 1000]]), catsMap, TODAY);
  // +500 en junio, −200 en julio → neto positivo, no se muestra nada.
  assert.equal(snap.globalAccumulated, null);
});

test('el acumulado global sólo se muestra si quedó en rojo', () => {
  const snap = buildSnapshot([], [], [{ month: '2026-01', amount: 1000 }],
    new Map([['2026-07', 100]]), catsMap, TODAY);
  assert.equal(snap.globalAccumulated, null);
});

test('los meses anteriores al primer monto fijado no cuentan', () => {
  // El monto arranca en julio: enero–junio no entran al acumulado aunque tengan gasto.
  const snap = buildSnapshot([], [], [{ month: '2026-07', amount: 100 }],
    new Map([['2026-03', 5000], ['2026-07', 300]]), catsMap, TODAY);
  assert.equal(snap.globalAccumulated, -200);
  assert.equal(snap.globalAccumMonths, 'Jul');
});

test('sin presupuesto global configurado no hay monto ni acumulado', () => {
  const snap = buildSnapshot([], [], [], new Map([['2026-08', 640]]), catsMap, TODAY);
  assert.equal(snap.monthlyBudget, null);
  assert.equal(snap.globalAccumulated, null);
  assert.equal(snap.globalStats.spent, 640);
});

// ── Generación de períodos (tiene que coincidir con la del SQL) ──────────────

test('getPeriodBounds da meses y años de calendario', () => {
  assert.deepEqual(getPeriodBounds('2026-03-15', 'monthly', 0), { start: '2026-03-01', end: '2026-03-31' });
  assert.deepEqual(getPeriodBounds('2026-03-15', 'monthly', 11), { start: '2027-02-01', end: '2027-02-28' });
  assert.deepEqual(getPeriodBounds('2023-11-30', 'monthly', 3), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(getPeriodBounds('2026-06-10', 'yearly', 0), { start: '2026-01-01', end: '2026-12-31' });
  assert.deepEqual(getPeriodBounds('2026-06-10', 'yearly', 2), { start: '2028-01-01', end: '2028-12-31' });
});
