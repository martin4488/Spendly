import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, addMonths, addYears, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ICON_KEYS } from '@/lib/iconMap';

// Global default currency — set once at boot via setDefaultCurrency()
let _defaultCurrency: string = 'USD';

export function setDefaultCurrency(code: string) {
  _defaultCurrency = code;
}

export function getDefaultCurrency(): string {
  return _defaultCurrency;
}

// Cache Intl.NumberFormat instances — avoids re-instantiation on every render
const _fmtCache = new Map<string, Intl.NumberFormat>();
const _fmtIntCache = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(code: string, round?: boolean): Intl.NumberFormat {
  if (round) {
    let fmt = _fmtIntCache.get(code);
    if (!fmt) {
      fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
      _fmtIntCache.set(code, fmt);
    }
    return fmt;
  }
  let fmt = _fmtCache.get(code);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
    });
    _fmtCache.set(code, fmt);
  }
  return fmt;
}

export function formatCurrency(amount: number, currency?: string, round?: boolean): string {
  const code = currency || _defaultCurrency;
  return getCurrencyFormatter(code, round).format(round ? Math.round(amount) : amount);
}

export function formatDate(date: string): string {
  return format(parseISO(date), 'dd MMM yyyy', { locale: es });
}

export function getMonthRange(date: Date = new Date()) {
  return {
    start: format(startOfMonth(date), 'yyyy-MM-dd'),
    end: format(endOfMonth(date), 'yyyy-MM-dd'),
  };
}

export function getYearRange(date: Date = new Date()) {
  return {
    start: format(startOfYear(date), 'yyyy-MM-dd'),
    end: format(endOfYear(date), 'yyyy-MM-dd'),
  };
}

export function getMonthName(date: Date = new Date()): string {
  return format(date, 'MMMM yyyy', { locale: es });
}

export function exportToCSV(data: any[], filename: string) {
  if (data.length === 0) return;
  
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h];
        if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
        return val ?? '';
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
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

export function getBudgetPeriodRange(startDateStr: string, recurrence: 'monthly' | 'yearly') {
  const startDate = parseISO(startDateStr);
  const today = new Date();

  let periodStart = startDate;
  let periodEnd: Date;

  if (recurrence === 'monthly') {
    while (addMonths(periodStart, 1) <= today) {
      periodStart = addMonths(periodStart, 1);
    }
    periodEnd = addMonths(periodStart, 1);
    periodEnd = new Date(periodEnd.getTime() - 86400000);
  } else {
    while (addYears(periodStart, 1) <= today) {
      periodStart = addYears(periodStart, 1);
    }
    periodEnd = addYears(periodStart, 1);
    periodEnd = new Date(periodEnd.getTime() - 86400000);
  }

  return {
    start: format(periodStart, 'yyyy-MM-dd'),
    end: format(periodEnd, 'yyyy-MM-dd'),
  };
}
