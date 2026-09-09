// Este módulo ya no necesita date-fns. `formatDate`, `getYearRange`,
// `getMonthName` y `getBudgetPeriodRange` no tenían ningún llamador, y
// `getMonthRange` sólo alimentaba una consulta muerta en CategoriesView; entre
// todos arrastraban parseISO, addMonths/addYears y el locale `es` a cada chunk
// que importa `formatCurrency`.
import { ICON_KEYS } from '@/lib/iconMap';
import { getDefaultCurrency } from '@/lib/currencyState';
import { formatWithCurrency } from '@/lib/currency';
import { toCsv } from '@/lib/csv';

// The currency global lives in `currencyState.ts` — importing it from here would
// pull date-fns + the icon registry into the boot chunk. Re-exported for the few
// call sites that still reach for it via utils.
export { setDefaultCurrency, getDefaultCurrency } from '@/lib/currencyState';

/**
 * Monto con símbolo, en el formato de la app (`€1.234.567,89`).
 *
 * Delega en `formatWithCurrency` para que esto y `<Amount>` no puedan volver a
 * divergir: esta función usaba `Intl` con locale en-US y estilo `currency`, así
 * que las vistas que mezclan las dos (Budgets, Reflect, Overview y los dos
 * detalles de presupuesto) mostraban `€1,234,567.89` al lado de `€1.234.567,89`.
 */
export function formatCurrency(amount: number, currency?: string, round?: boolean): string {
  return formatWithCurrency(amount, currency || getDefaultCurrency(), round);
}

export function exportToCSV(data: any[], filename: string) {
  if (data.length === 0) return;

  // BOM para que Excel abra los acentos bien. `trim()` se lo lleva al importar.
  const blob = new Blob(['\ufeff' + toCsv(data)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revocar en el mismo tick cancela la descarga en Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Re-export icon keys as CATEGORY_ICONS for backward compat
export const CATEGORY_ICONS = ICON_KEYS;

export const CATEGORY_COLORS = [
  '#ef4444', '#dc2626', '#b91c1c',
  '#f97316', '#ea580c', '#c2410c',
  '#f59e0b', '#d97706', '#b45309',
  '#eab308', '#ca8a04', '#a16207',
  '#84cc16', '#65a30d', '#4d7c0f',
  '#22c55e', '#16a34a', '#15803d',
  '#14b8a6', '#0d9488', '#0f766e',
  '#06b6d4', '#0891b2', '#0e7490',
  '#0ea5e9', '#0284c7', '#0369a1',
  '#3b82f6', '#2563eb', '#1d4ed8',
  '#6366f1', '#4f46e5', '#4338ca',
  '#8b5cf6', '#7c3aed', '#6d28d9',
  '#a855f7', '#9333ea', '#7e22ce',
  '#d946ef', '#c026d3', '#a21caf',
  '#ec4899', '#db2777', '#be185d',
  '#f43f5e', '#e11d48', '#be123c',
  '#78716c', '#57534e', '#44403c',
  '#64748b', '#475569', '#334155',
];
