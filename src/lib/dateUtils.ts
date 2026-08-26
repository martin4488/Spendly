/**
 * dateUtils.ts
 *
 * Fechas *locales*, sin dependencias (no importa date-fns a propósito: lo usan
 * `page.tsx` y el modal de gastos, que están en el camino crítico).
 *
 * Por qué existe: el código usaba dos patrones que rompen en cualquier zona con
 * offset negativo — o sea, acá (UTC-3):
 *
 *   new Date().toISOString().split('T')[0]
 *       → después de las 21:00 devuelve *mañana*. Un gasto cargado a la noche
 *         se guardaba con la fecha del día siguiente.
 *
 *   new Date(`${'2026-08'}-01`)
 *       → los strings ISO de solo-fecha se parsean como UTC, así que da el
 *         31/07 21:00 local. `format(..., 'yyyy-MM')` devolvía el mes anterior,
 *         `endOfMonth()` el fin del mes anterior, y en `saveMonthlyBudget` el
 *         mes nunca avanzaba: while (m <= curMonth) era un loop infinito.
 *
 * Regla: para todo lo que sea 'yyyy-MM-dd' / 'yyyy-MM' se usa aritmética de
 * strings o constructores locales `new Date(y, m, d)`. Nunca `Date.parse` de un
 * ISO de solo-fecha, nunca `toISOString()` para derivar un día del calendario.
 */

/** Fecha local de un Date como 'yyyy-MM-dd'. */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Hoy, en el calendario local, como 'yyyy-MM-dd'. */
export function todayStr(): string {
  return toDateStr(new Date());
}

/** Ayer, en el calendario local. Resta un día de calendario, no 24 h (DST-safe). */
export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

/** Mes local de un Date como 'yyyy-MM'. */
export function toMonthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** El mes actual como 'yyyy-MM'. */
export function currentMonthStr(): string {
  return toMonthStr(new Date());
}

/**
 * Parsea 'yyyy-MM' o 'yyyy-MM-dd' a un Date **local** a medianoche.
 * Reemplaza a `new Date(str)` / `parseISO(str)` donde después se formatea.
 */
export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-');
  return new Date(Number(y), Number(m) - 1, d ? Number(d) : 1);
}

/** Primer día de un mes 'yyyy-MM' → 'yyyy-MM-dd'. */
export function monthStartStr(month: string): string {
  return `${month}-01`;
}

/** Último día de un mes 'yyyy-MM' → 'yyyy-MM-dd'. Aritmética pura, sin Date. */
export function monthEndStr(month: string): string {
  const [y, m] = month.split('-').map(Number);
  // Día 0 del mes siguiente = último día de éste. `new Date(y, m, 0)` es local.
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/** Suma (o resta) meses a un 'yyyy-MM'. Sin Date → sin deriva de timezone. */
export function addMonthsStr(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  return `${ny}-${String(nm + 1).padStart(2, '0')}`;
}

/** Suma (o resta) días a un 'yyyy-MM-dd'. Sin deriva de timezone ni de DST. */
export function addDaysStr(dateStr: string, n: number): string {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** Lista de meses 'yyyy-MM' desde `from` hasta `to`, ambos inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  let m = from;
  // El tope es defensivo: sin él, un `from` corrupto colgaría el hilo.
  for (let i = 0; m <= to && i < 1200; i++) {
    out.push(m);
    m = addMonthsStr(m, 1);
  }
  return out;
}
