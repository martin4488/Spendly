import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
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

export const CATEGORY_ICONS = [
  '🏠', '🚗', '🍔', '🛒', '💊', '🎬', '👕', '📱', '✈️', '📚',
  '🏋️', '🐕', '🎁', '💡', '🔧', '💰', '🎵', '🍺', '☕', '🧹',
  '👶', '💻', '🏦', '📦', '🎓', '💇', '🚌', '🏥', '📰', '🎮',
];

export const CATEGORY_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#78716c', '#64748b', '#0d9488', '#7c3aed',
];
