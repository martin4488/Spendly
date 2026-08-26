/**
 * Fechas locales — regresión de los bugs de zona horaria.
 *
 * Todos los bugs que este módulo arregla eran invisibles en UTC y sólo
 * aparecían con offset negativo (o sea, en Buenos Aires):
 *
 *   - `new Date('2026-03-01')` se parsea como UTC → 28/02 21:00 local, así que
 *     `format(..., 'yyyy-MM')` devolvía el mes anterior. En
 *     `BudgetsView.saveMonthlyBudget` eso hacía que el mes nunca avanzara y el
 *     `while (m <= curMonth)` colgaba la pestaña.
 *   - `new Date().toISOString().split('T')[0]` da el día en UTC → un gasto
 *     cargado después de las 21:00 nacía fechado al día siguiente.
 *
 * Por eso el grueso corre en subprocesos con TZ forzada: en la TZ de la máquina
 * que corra los tests podría pasar igual estando roto.
 *
 * No necesita red ni credenciales.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  addDaysStr, addMonthsStr, monthEndStr, monthRange, parseLocalDate, toDateStr, toMonthStr,
} from '../src/lib/dateUtils.ts';

const MODULE = fileURLToPath(new URL('../src/lib/dateUtils.ts', import.meta.url));

// Offsets negativos (donde estaban los bugs), UTC, y uno positivo de control.
const ZONES = ['America/Argentina/Buenos_Aires', 'America/Los_Angeles', 'UTC', 'Asia/Tokyo'];

/** Corre `body` con TZ forzada. Devuelve lo que el script imprima. */
function inZone(tz, body) {
  return execFileSync(
    process.execPath,
    ['--no-warnings', '--input-type=module', '-e',
      `const M = await import(${JSON.stringify(MODULE)});\n${body}`],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' },
  ).trim();
}

test('la aritmética de meses no depende de la zona horaria', () => {
  // El caso exacto que colgaba: en UTC-3 el mes se quedaba clavado.
  for (const tz of ZONES) {
    const out = inZone(tz, `
      const meses = [];
      let m = '2026-01';
      for (let i = 0; i < 5; i++) m = M.addMonthsStr(m, 1), meses.push(m);
      console.log(meses.join(','));
    `);
    assert.equal(out, '2026-02,2026-03,2026-04,2026-05,2026-06', `falla en ${tz}`);
  }
});

test('monthRange termina siempre — nunca se queda en el mismo mes', () => {
  for (const tz of ZONES) {
    const out = inZone(tz, `console.log(M.monthRange('2026-01', '2026-04').join(','));`);
    assert.equal(out, '2026-01,2026-02,2026-03,2026-04', `falla en ${tz}`);
  }
  // Un solo mes, y un rango invertido (no debe colgar ni inventar meses).
  assert.deepEqual(monthRange('2026-05', '2026-05'), ['2026-05']);
  assert.deepEqual(monthRange('2026-05', '2026-04'), []);
});

test('el fin de mes es el del mes pedido, no el del anterior', () => {
  for (const tz of ZONES) {
    const out = inZone(tz, `console.log([
      M.monthEndStr('2026-03'), M.monthEndStr('2026-02'),
      M.monthEndStr('2024-02'), M.monthEndStr('2026-12'),
    ].join(','));`);
    assert.equal(out, '2026-03-31,2026-02-28,2024-02-29,2026-12-31', `falla en ${tz}`);
  }
});

test('la fecha de un gasto cargado de noche es la de hoy, no la de mañana', () => {
  for (const tz of ZONES) {
    // 22:30 hora local: en UTC-3 `toISOString()` ya está en el día siguiente.
    const out = inZone(tz, `console.log(M.toDateStr(new Date(2026, 7, 25, 22, 30)));`);
    assert.equal(out, '2026-08-25', `falla en ${tz}`);
    const madrugada = inZone(tz, `console.log(M.toDateStr(new Date(2026, 7, 25, 0, 30)));`);
    assert.equal(madrugada, '2026-08-25', `falla en ${tz}`);
  }
});

test('parseLocalDate cae en el día pedido, no en el anterior', () => {
  for (const tz of ZONES) {
    const out = inZone(tz, `
      const d = M.parseLocalDate('2026-03-01');
      const mo = M.parseLocalDate('2026-03');
      console.log([d.getFullYear(), d.getMonth(), d.getDate(), mo.getMonth(), mo.getDate()].join(','));
    `);
    assert.equal(out, '2026,2,1,2,1', `falla en ${tz}`);
  }
});

test('addDaysStr cruza fin de mes, año bisiesto y cambio de hora', () => {
  assert.equal(addDaysStr('2026-08-31', 1), '2026-09-01');
  assert.equal(addDaysStr('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysStr('2024-02-28', 1), '2024-02-29');
  // Domingo de cambio de hora en varias zonas: restar 24 h daría el mismo día.
  for (const tz of ZONES) {
    const out = inZone(tz, `console.log([
      M.addDaysStr('2026-03-08', 1), M.addDaysStr('2026-11-01', 1),
    ].join(','));`);
    assert.equal(out, '2026-03-09,2026-11-02', `falla en ${tz}`);
  }
});

test('toMonthStr y toDateStr coinciden con el calendario local', () => {
  const d = new Date(2026, 0, 5, 13, 0);
  assert.equal(toDateStr(d), '2026-01-05');
  assert.equal(toMonthStr(d), '2026-01');
  assert.equal(monthEndStr(toMonthStr(d)), '2026-01-31');
  assert.equal(addMonthsStr(toMonthStr(d), -1), '2025-12');
  assert.equal(parseLocalDate('2026-01-05').getDate(), 5);
});
