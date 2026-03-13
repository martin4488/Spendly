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
  '🚗', '✈️', '🍴', '👤', '💵', '🎭', '🏠', '⚡', '🛍️', '🚙',
  '🩺', '❓', '👕', '🚇', '🥐', '🍸', '⚽', '🐾', '🎓', '🧭',
  '❤️', '🚜', '🏦', '🎵', '👛', '🎁', '⛽', '🧴', '💰', '🪑',
  '☕', '📱', '💻', '🎮', '📚', '👶', '💊', '🏋️', '🧹', '💇',
  '📰', '🏥', '🔧', '🎬', '💡', '🐕', '🚌', '📦', '🛒', '🍺',
  '🧑‍💼', '🎨', '🌍', '🏖️', '🧸', '💎', '🎂', '🧪', '📸', '🪴',
];

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
