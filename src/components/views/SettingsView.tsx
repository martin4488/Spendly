'use client';

import { useState, useRef, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { exportToCSV } from '@/lib/utils';
import { CURRENCIES, CurrencyCode } from '@/lib/currency';
import {
  LogOut, Download, Upload, Mail, DollarSign, Tag, ChevronRight,
  CheckCircle, AlertCircle, X, Check,
} from 'lucide-react';

interface Props {
  user: User;
  defaultCurrency: CurrencyCode;
  onCurrencyChange: (currency: CurrencyCode) => void;
  onOpenCategories: () => void;
}

interface ImportRow {
  date: string;
  description: string;
  amount: string;
  currency: string;
  category: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/* ── Shared row component ──────────────────────────────────────────────── */

type RowProps = {
  icon: ReactNode;
  title: string;
  sub?: string;
  value?: string;
  danger?: boolean;
  loading?: boolean;
  onClick?: () => void;
};

function SettingRow({ icon, title, sub, value, danger, loading, onClick }: RowProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-white/[0.02] transition-colors"
    >
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
        danger ? 'bg-red-500/10 text-red-400' : 'bg-white/[0.04] text-dark-400'
      }`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-medium ${danger ? 'text-red-400' : ''}`}>{title}</div>
        {sub && <div className="text-[11px] text-dark-500 mt-0.5">{sub}</div>}
      </div>
      {loading && <div className="w-4 h-4 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />}
      {value && <span className="font-mono text-xs text-dark-400">{value}</span>}
      {!value && !danger && !loading && <ChevronRight className="w-4 h-4 text-dark-500" />}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-mono text-[10px] font-semibold tracking-wider uppercase text-dark-500 mb-2 pl-1">
      {children}
    </h2>
  );
}

/* ── Main component ────────────────────────────────────────────────────── */

export default function SettingsView({ user, defaultCurrency, onCurrencyChange, onOpenCategories }: Props) {
  const [exporting, setExporting] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [previewRows, setPreviewRows] = useState<ImportRow[] | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [showCurrencySheet, setShowCurrencySheet] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Currency ── */
  async function handleCurrencyChange(currency: CurrencyCode) {
    setSavingCurrency(true);
    setShowCurrencySheet(false);
    try {
      await supabase
        .from('user_settings')
        .update({ default_currency: currency })
        .eq('user_id', user.id);
      onCurrencyChange(currency);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingCurrency(false);
    }
  }

  /* ── Export ── */
  async function handleExportAll() {
    setExporting(true);
    try {
      const { data: expenses } = await supabase
        .from('expenses')
        .select('*, category:categories(name)')
        .eq('user_id', user.id)
        .order('date', { ascending: false });

      if (expenses && expenses.length > 0) {
        const data = expenses.map(e => ({
          Fecha: e.date,
          Descripción: e.description,
          Categoría: (e as any).category?.name || 'Sin categoría',
          Monto: e.amount,
          Moneda_Original: e.original_currency || defaultCurrency,
          Monto_Original: e.original_amount || e.amount,
          Notas: e.notes || '',
          Recurrente: e.is_recurring ? 'Sí' : 'No',
        }));
        exportToCSV(data, 'spendly-todos-los-gastos');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  }

  /* ── CSV parsing ── */
  function parseCSV(text: string): ImportRow[] {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
    const rows: ImportRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const cols: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '"') { inQuotes = !inQuotes; }
        else if (line[c] === ',' && !inQuotes) { cols.push(current); current = ''; }
        else { current += line[c]; }
      }
      cols.push(current);
      const row: any = {};
      header.forEach((h, idx) => { row[h] = (cols[idx] || '').trim(); });
      rows.push({
        date: row['date'] || row['fecha'] || '',
        description: row['description'] || row['descripcin'] || row['descripcion'] || '',
        amount: row['amount'] || row['monto'] || '0',
        currency: row['currency'] || row['moneda'] || defaultCurrency,
        category: row['category'] || row['categora'] || row['categoria'] || '',
      });
    }
    return rows;
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      setPreviewRows(rows);
      setPreviewFile(file);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function cancelImport() {
    setPreviewRows(null);
    setPreviewFile(null);
  }

  async function confirmImport() {
    if (!previewRows) return;
    setImporting(true);
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

    try {
      const { data: categories } = await supabase
        .from('categories')
        .select('id, name, parent_id, icon, color, hidden')
        .eq('user_id', user.id);

      const allCats = categories || [];
      const catMap = new Map<string, typeof allCats[0]>();
      allCats.forEach(c => catMap.set(c.name.toLowerCase().trim(), c));

      const importedSubCache = new Map<string, string>();

      const getOrCreateImportedSub = async (parentCat: typeof allCats[0]): Promise<string> => {
        if (importedSubCache.has(parentCat.id)) return importedSubCache.get(parentCat.id)!;

        const existing = allCats.find(
          c => c.parent_id === parentCat.id && c.hidden === true && c.name === 'Importado'
        );
        if (existing) {
          importedSubCache.set(parentCat.id, existing.id);
          return existing.id;
        }

        const { data, error } = await supabase
          .from('categories')
          .insert({
            user_id: user.id,
            name: 'Importado',
            icon: parentCat.icon,
            color: parentCat.color,
            parent_id: parentCat.id,
            hidden: true,
            position: 999,
          })
          .select('id')
          .single();

        if (error || !data) throw new Error(`No se pudo crear subcategoría oculta: ${error?.message}`);
        importedSubCache.set(parentCat.id, data.id);
        return data.id;
      };

      const toInsert: any[] = [];

      for (const row of previewRows) {
        const amount = parseFloat(row.amount);
        if (!row.date || isNaN(amount)) {
          result.skipped++;
          result.errors.push(`Fila inválida: "${row.description || row.date}"`);
          continue;
        }

        const catNameLower = row.category.toLowerCase().trim();
        let matchedCat = catMap.get(catNameLower) || null;

        if (!matchedCat && catNameLower) {
          const entries = Array.from(catMap.entries());
          for (const [name, cat] of entries) {
            if (name.includes(catNameLower) || catNameLower.includes(name)) {
              matchedCat = cat;
              break;
            }
          }
        }

        let categoryId: string | null = null;

        if (matchedCat) {
          const isParent = !matchedCat.parent_id;
          if (isParent) {
            categoryId = await getOrCreateImportedSub(matchedCat);
          } else {
            categoryId = matchedCat.id;
          }
        }

        const currency = row.currency?.toUpperCase() || defaultCurrency;
        const isMainCurrency = currency === defaultCurrency;

        toInsert.push({
          user_id: user.id,
          description: row.description || 'Sin descripción',
          amount: amount,
          date: row.date,
          category_id: categoryId,
          original_currency: isMainCurrency ? null : currency,
          original_amount: isMainCurrency ? null : amount,
          is_recurring: false,
          notes: null,
        });
      }

      const batchSize = 50;
      for (let i = 0; i < toInsert.length; i += batchSize) {
        const batch = toInsert.slice(i, i + batchSize);
        const { error } = await supabase.from('expenses').insert(batch);
        if (error) {
          result.errors.push(`Error al insertar lote: ${error.message}`);
          result.skipped += batch.length;
        } else {
          result.imported += batch.length;
        }
      }
    } catch (err: any) {
      result.errors.push(err.message || 'Error desconocido');
    }

    setImporting(false);
    setPreviewRows(null);
    setPreviewFile(null);
    setImportResult(result);
  }

  async function handleLogout() {
    if (confirm('¿Cerrar sesión?')) {
      await supabase.auth.signOut();
    }
  }

  return (
    <div className="pb-24 max-w-lg mx-auto page-transition">
      <header className="px-5 pt-6 pb-4">
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Ajustes</h1>
      </header>

      {/* ── Cuenta ── */}
      <section className="px-5 mb-5">
        <SectionLabel>Cuenta</SectionLabel>
        <div className="bg-dark-800 rounded-xl overflow-hidden">
          <SettingRow
            icon={<Mail className="w-3.5 h-3.5" />}
            title={user.email || ''}
            sub="Cuenta verificada"
          />
        </div>
      </section>

      {/* ── Preferencias ── */}
      <section className="px-5 mb-5">
        <SectionLabel>Preferencias</SectionLabel>
        <div className="bg-dark-800 rounded-xl overflow-hidden divide-y divide-white/[0.06]">
          <SettingRow
            icon={<DollarSign className="w-3.5 h-3.5" />}
            title="Moneda principal"
            sub="Todos los gastos se convierten a esta"
            value={savingCurrency ? '...' : defaultCurrency}
            onClick={() => setShowCurrencySheet(true)}
          />
          <SettingRow
            icon={<Tag className="w-3.5 h-3.5" />}
            title="Categorías"
            sub="Organizá tus gastos por categoría"
            onClick={onOpenCategories}
          />
        </div>
      </section>

      {/* ── Currency sheet ── */}
      {showCurrencySheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowCurrencySheet(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full max-w-lg bg-dark-900 rounded-t-2xl pb-8 slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="text-base font-bold">Moneda principal</h3>
              <button onClick={() => setShowCurrencySheet(false)} className="text-dark-400 p-1">
                <X size={18} />
              </button>
            </div>
            <div className="px-3">
              {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => {
                const c = CURRENCIES[code];
                const isActive = defaultCurrency === code;
                return (
                  <button
                    key={code}
                    onClick={() => handleCurrencyChange(code)}
                    className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-xl transition-colors ${
                      isActive ? 'bg-brand-600/10' : 'active:bg-white/[0.02]'
                    }`}
                  >
                    <span className="text-xl">{c.flag}</span>
                    <div className="flex-1 text-left">
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className="text-xs text-dark-400 ml-2">{c.symbol}</span>
                    </div>
                    {isActive && <Check size={16} className="text-brand-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Datos ── */}
      <section className="px-5 mb-5">
        <SectionLabel>Datos</SectionLabel>
        <div className="bg-dark-800 rounded-xl overflow-hidden divide-y divide-white/[0.06]">
          <SettingRow
            icon={<Download className="w-3.5 h-3.5" />}
            title="Exportar CSV"
            sub="Descargar historial completo"
            loading={exporting}
            onClick={handleExportAll}
          />
          <SettingRow
            icon={<Upload className="w-3.5 h-3.5" />}
            title="Importar desde CSV"
            sub="date, description, amount, category"
            loading={importing}
            onClick={() => fileInputRef.current?.click()}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileSelect}
          className="hidden"
        />
      </section>

      {/* ── Import preview ── */}
      {previewRows && (
        <section className="px-5 mb-5">
          <div className="bg-dark-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h3 className="text-sm font-semibold text-dark-300">
                Vista previa — {previewRows.length} registros
              </h3>
              <button onClick={cancelImport} className="text-dark-400 hover:text-dark-200 transition-colors">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-dark-500 px-4 pb-3">{previewFile?.name}</p>
            <div className="px-4 pb-2 max-h-48 overflow-y-auto">
              {previewRows.slice(0, 8).map((row, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-dark-700 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{row.description || '—'}</p>
                    <p className="text-xs text-dark-400">{row.date} · {row.category || 'Sin cat.'}</p>
                  </div>
                  <p className="text-xs font-semibold text-red-400 ml-3 shrink-0">
                    -{parseFloat(row.amount || '0').toFixed(2)} {row.currency}
                  </p>
                </div>
              ))}
              {previewRows.length > 8 && (
                <p className="text-xs text-dark-500 py-2 text-center">+{previewRows.length - 8} más...</p>
              )}
            </div>
            <div className="flex gap-2 px-4 pb-4 pt-2">
              <button
                onClick={cancelImport}
                className="flex-1 py-2.5 rounded-xl bg-dark-700 hover:bg-dark-600 text-sm text-dark-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmImport}
                disabled={importing}
                className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-medium text-white transition-colors disabled:opacity-50"
              >
                {importing ? 'Importando...' : 'Confirmar importación'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Import result ── */}
      {importResult && (
        <section className="px-5 mb-5">
          <div className="bg-dark-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {importResult.imported > 0
                  ? <CheckCircle size={16} className="text-green-400" />
                  : <AlertCircle size={16} className="text-red-400" />
                }
                <h3 className="text-sm font-semibold">Resultado de importación</h3>
              </div>
              <button onClick={() => setImportResult(null)} className="text-dark-400 hover:text-dark-200">
                <X size={14} />
              </button>
            </div>
            <p className="text-sm text-green-400">{importResult.imported} gastos importados</p>
            {importResult.skipped > 0 && (
              <p className="text-sm text-yellow-400">{importResult.skipped} filas omitidas</p>
            )}
            {importResult.errors.slice(0, 3).map((e, i) => (
              <p key={i} className="text-xs text-dark-400 mt-1">{e}</p>
            ))}
          </div>
        </section>
      )}

      {/* ── Sesión ── */}
      <section className="px-5">
        <div className="bg-dark-800 rounded-xl overflow-hidden">
          <SettingRow
            icon={<LogOut className="w-3.5 h-3.5" />}
            title="Cerrar sesión"
            danger
            onClick={handleLogout}
          />
        </div>
      </section>
    </div>
  );
}
