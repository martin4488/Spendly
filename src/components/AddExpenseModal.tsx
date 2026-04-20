'use client';

import { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Category } from '@/types';
import { CURRENCIES, convertCurrency, formatWithCurrency, CurrencyCode } from '@/lib/currency';
import { CATEGORY_ICONS, CATEGORY_COLORS } from '@/lib/utils';
import { X, Calendar, Delete, ChevronDown, Search, Settings, ArrowLeft, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

interface Props {
  user: User;
  defaultCurrency: CurrencyCode;
  onClose: () => void;
  onSaved: () => void;
  editingExpense?: {
    id: string;
    amount: number;
    description: string;
    category_id: string | null;
    date: string;
    original_currency?: string | null;
    original_amount?: number | null;
  } | null;
}

// ── Color derivation ──────────────────────────────────────────────────────────
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0; const l = (max+min)/2;
  if (max !== min) {
    const d = max-min; s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) { case r: h=((g-b)/d+(g<b?6:0))/6; break; case g: h=((b-r)/d+2)/6; break; case b: h=((r-g)/d+4)/6; break; }
  }
  return [Math.round(h*360), Math.round(s*100), Math.round(l*100)];
}
function hslToHex(h: number, s: number, l: number): string {
  const hn=h/360,sn=s/100,ln=l/100;
  const hue2rgb=(p:number,q:number,t:number)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
  let r,g,b;
  if(sn===0){r=g=b=ln;}else{const q=ln<0.5?ln*(1+sn):ln+sn-ln*sn;const p=2*ln-q;r=hue2rgb(p,q,hn+1/3);g=hue2rgb(p,q,hn);b=hue2rgb(p,q,hn-1/3);}
  const th=(x:number)=>Math.round(x*255).toString(16).padStart(2,'0');
  return `#${th(r)}${th(g)}${th(b)}`;
}
function deriveChildColor(parentHex: string, siblingCount: number): string {
  const [h,s,l] = hexToHsl(parentHex);
  const newL = Math.min(88, l + 4 + siblingCount * 7);
  const newS = Math.max(15, s - 4 - siblingCount * 7);
  return hslToHex(h, newS, newL);
}

import { CatNode, FlatEntry, buildTree, flattenTree } from '@/lib/categoryTree';
import { getCategories, invalidateCategories } from '@/lib/categoryCache';

// ── Frecuentes: exponential decay scoring in localStorage ────────────────────
// Each category stores { score, ts } where ts = last update timestamp (ms).
// On bump: score = oldScore * decay^(daysSinceLast) + 1
// This means recent usage weighs more; old usage fades over ~30 days.
const FREQ_KEY = 'spendly_cat_freq';
const HALF_LIFE_DAYS = 14; // score halves every 14 days of inactivity
const DECAY = Math.pow(0.5, 1 / HALF_LIFE_DAYS); // ~0.9518 per day

type FreqEntry = { s: number; t: number }; // score, timestamp
type FreqData = Record<string, FreqEntry>;

function loadFreqData(): FreqData {
  try {
    const raw = localStorage.getItem(FREQ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migration: if old format (plain numbers), convert
    if (typeof Object.values(parsed)[0] === 'number') {
      const migrated: FreqData = {};
      const now = Date.now();
      for (const [id, count] of Object.entries(parsed)) {
        migrated[id] = { s: count as number, t: now };
      }
      localStorage.setItem(FREQ_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return parsed;
  } catch { return {}; }
}

function bumpCatFrequency(catId: string) {
  try {
    const data = loadFreqData();
    const now = Date.now();
    const entry = data[catId];
    if (entry) {
      const days = (now - entry.t) / 86_400_000;
      const decayed = entry.s * Math.pow(DECAY, days);
      data[catId] = { s: decayed + 1, t: now };
    } else {
      data[catId] = { s: 1, t: now };
    }
    localStorage.setItem(FREQ_KEY, JSON.stringify(data));
  } catch {}
}

function getTopFrequent(allCats: Category[], limit = 10): Category[] {
  const data = loadFreqData();
  const now = Date.now();
  // Compute current decayed scores without mutating storage
  const scores: [string, number][] = [];
  for (const [id, entry] of Object.entries(data)) {
    const days = (now - entry.t) / 86_400_000;
    const current = entry.s * Math.pow(DECAY, days);
    if (current > 0.1) scores.push([id, current]); // ignore near-zero
  }
  scores.sort((a, b) => b[1] - a[1]);
  return scores
    .slice(0, limit)
    .map(([id]) => allCats.find(c => c.id === id))
    .filter((c): c is Category => !!c && !c.hidden);
}

export default function AddExpenseModal({ user, defaultCurrency, onClose, onSaved, editingExpense }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [roots, setRoots] = useState<CatNode[]>([]);
  const [amountStr, setAmountStr] = useState(
    editingExpense ? String(editingExpense.original_amount || editingExpense.amount) : ''
  );
  const [description, setDescription] = useState(editingExpense?.description || '');
  const [categoryId, setCategoryId] = useState(editingExpense?.category_id || '');
  const [date, setDate] = useState(editingExpense?.date || new Date().toISOString().split('T')[0]);
  const [currency, setCurrency] = useState<CurrencyCode>((editingExpense?.original_currency as CurrencyCode) || defaultCurrency);
  const [showDatePicker, setShowDatePicker] = useState(false);
  // Open category picker immediately for new expenses (not edits)
  const [showCategoryPicker, setShowCategoryPicker] = useState(!editingExpense);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Create category
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('📦');
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
  const [newCatParentId, setNewCatParentId] = useState<string | null>(null);
  const [savingCat, setSavingCat] = useState(false);

  // Frecuentes
  const [frequentCats, setFrequentCats] = useState<Category[]>([]);

  useEffect(() => { loadCategories(); }, [user.id]);

  async function loadCategories() {
    const catsMap = await getCategories(user.id);
    const flat = Array.from(catsMap.values()).filter(c => !c.hidden);
    setCategories(flat);
    setRoots(buildTree(flat));
    setFrequentCats(getTopFrequent(flat));
  }

  const selectedCat = categories.find(c => c.id === categoryId);
  const headerColor = selectedCat?.color || '#475569';
  const headerIcon = selectedCat?.icon || '💵';
  const headerName = selectedCat?.name || 'Categoría';
  const displayAmount = amountStr || '0';

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const dateLabel = (() => {
    if (date === today) return 'Hoy';
    if (date === yesterday) return 'Ayer';
    try { return format(parseISO(date), "d 'de' MMM yyyy", { locale: es }); }
    catch { return date; }
  })();

  const amt = parseFloat(amountStr) || 0;
  const isOtherCurrency = currency !== defaultCurrency;
  const convertedAmount = isOtherCurrency ? convertCurrency(amt, currency, defaultCurrency) : null;
  const currencyInfo = CURRENCIES[currency];
  const canSave = !saving && !!amountStr && parseFloat(amountStr) > 0 && !!categoryId;

  // Search across all levels
  const allEntries = flattenTree(roots);
  const q = searchQuery.trim().toLowerCase();
  const searchResults = q ? allEntries.filter(e => e.cat.name.toLowerCase().includes(q)) : [];

  // Root cats for create picker
  const rootCats = categories.filter(c => !c.parent_id);

  function handleNumpad(key: string) {
    if (key === 'backspace') { setAmountStr(prev => prev.slice(0, -1)); }
    else if (key === '.') { if (!amountStr.includes('.')) setAmountStr(prev => (prev || '0') + '.'); }
    else {
      if (amountStr.includes('.')) { const d = amountStr.split('.')[1]; if (d && d.length >= 2) return; }
      setAmountStr(prev => prev + key);
    }
  }

  function handleSelectCategory(id: string) {
    setCategoryId(id);
    bumpCatFrequency(id);
    setShowCategoryPicker(false);
    setSearchQuery('');
  }

  function openCreateCategory(parentId: string | null = null) {
    setNewCatParentId(parentId);
    setNewCatName('');
    if (parentId) {
      const parent = categories.find(c => c.id === parentId);
      setNewCatIcon(parent?.icon || '📦');
      const siblingCount = categories.filter(c => c.parent_id === parentId).length;
      setNewCatColor(parent ? deriveChildColor(parent.color, siblingCount) : CATEGORY_COLORS[0]);
    } else {
      setNewCatIcon('📦');
      setNewCatColor(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
    }
    setShowCreateCategory(true);
  }

  async function handleCreateCategory() {
    if (!newCatName) return;
    setSavingCat(true);
    try {
      const { data } = await supabase.from('categories')
        .insert({ user_id: user.id, name: newCatName, icon: newCatIcon, color: newCatColor, parent_id: newCatParentId })
        .select().single();
      invalidateCategories();
      await loadCategories();
      if (data) { setCategoryId(data.id); bumpCatFrequency(data.id); setShowCreateCategory(false); setShowCategoryPicker(false); setSearchQuery(''); }
    } catch (err) { console.error(err); }
    finally { setSavingCat(false); }
  }

  async function handleSave() {
    const amt = parseFloat(amountStr);
    if (!amt || amt <= 0 || !categoryId) return;
    setSaving(true);
    let finalAmount = amt, originalCurrency: string | null = null, originalAmount: number | null = null;
    if (isOtherCurrency) {
      const converted = convertCurrency(amt, currency, defaultCurrency);
      if (converted !== null) { finalAmount = converted; originalCurrency = currency; originalAmount = amt; }
    }
    const data = { user_id: user.id, amount: finalAmount, description: description || null, notes: null, category_id: categoryId, date, original_currency: originalCurrency, original_amount: originalAmount };
    try {
      if (editingExpense) await supabase.from('expenses').update(data).eq('id', editingExpense.id);
      else await supabase.from('expenses').insert(data);
      onSaved(); onClose();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-dark-900">

      {/* ── HEADER ── */}
      <div className="pt-12 pb-5 px-5 relative flex-shrink-0" style={{ backgroundColor: headerColor }}>
        <button onClick={onClose} className="absolute top-4 left-4 p-1 text-white/80 hover:text-white"><X size={24} /></button>
        <p className="text-center text-white/90 text-sm font-semibold mb-4">
          {editingExpense ? 'Editar gasto' : `Agregar ${headerName}`}
        </p>
        <div className="flex items-center justify-between">
          <button onClick={() => setShowCategoryPicker(true)}
            className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl">
            {headerIcon}
          </button>
          <div className="text-right">
            <div className="flex items-center justify-end gap-2">
              <span className="text-3xl font-extrabold text-white">{displayAmount}</span>
              <button onClick={() => setShowCurrencyPicker(true)}
                className="flex items-center gap-0.5 bg-white/20 rounded-full px-2 py-1 text-white/90">
                <span className="text-xs font-semibold">{currencyInfo.symbol}</span>
                <ChevronDown size={12} />
              </button>
            </div>
            {isOtherCurrency && convertedAmount !== null && amt > 0 && (
              <p className="text-white/50 text-xs mt-0.5">≈ {formatWithCurrency(convertedAmount, defaultCurrency)}</p>
            )}
            {!isOtherCurrency && <p className="text-white/60 text-xs mt-0.5">{currency}</p>}
          </div>
        </div>
      </div>

      {/* ── FORM FIELDS ── */}
      <div className="flex-1 overflow-y-auto">
        <button onClick={() => setShowDatePicker(!showDatePicker)}
          className="flex items-center gap-3 px-5 py-4 border-b border-dark-800 w-full">
          <Calendar size={18} className="text-dark-400" />
          <span className="text-sm font-medium flex-1 text-left capitalize">{dateLabel}</span>
          {date === today && (
            <span onClick={(e) => { e.stopPropagation(); setDate(yesterday); }}
              className="text-xs text-dark-500 border border-dashed border-dark-600 rounded-full px-3 py-1">Ayer?</span>
          )}
        </button>
        {showDatePicker && (
          <div className="px-5 py-3 border-b border-dark-800 bg-dark-800/50">
            <input type="date" value={date}
              onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { setDate(v); setShowDatePicker(false); } }}
              className="w-full bg-dark-700 border border-dark-600 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors" />
          </div>
        )}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-dark-800">
          <span className="text-dark-400 text-lg">✏️</span>
          <input type="text" placeholder="Descripción" value={description} onChange={(e) => setDescription(e.target.value)}
            className="flex-1 bg-transparent text-sm placeholder:text-dark-500 focus:outline-none" />
        </div>

      </div>

      {/* ── BOTTOM ── */}
      <div className="flex-shrink-0">
        <div className="px-5 py-3">
          <button onClick={handleSave} disabled={!canSave}
            className="w-full py-4 rounded-2xl font-bold text-base transition-all disabled:opacity-40"
            style={{ backgroundColor: headerColor, color: 'white' }}>
            {saving ? 'Guardando...' : editingExpense ? 'Guardar cambios' : 'Agregar gasto'}
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

      {/* ── CURRENCY PICKER ── */}
      {showCurrencyPicker && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end">
          <div className="bg-dark-800 w-full rounded-t-3xl slide-up">
            <div className="flex items-center justify-between p-4 border-b border-dark-700">
              <h3 className="text-base font-bold">Moneda</h3>
              <button onClick={() => setShowCurrencyPicker(false)} className="p-1 text-dark-400"><X size={20} /></button>
            </div>
            {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => {
              const c = CURRENCIES[code]; const isActive = currency === code;
              return (
                <button key={code} onClick={() => { setCurrency(code); setShowCurrencyPicker(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-4 border-b border-dark-700/30 active:bg-dark-700/50 transition-colors ${isActive ? 'bg-dark-700/30' : ''}`}>
                  <span className="text-2xl">{c.flag}</span>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-dark-400">{c.code} · {c.symbol}</p>
                  </div>
                  {isActive && <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>}
                </button>
              );
            })}
            <div className="h-8" />
          </div>
        </div>
      )}

      {/* ── CATEGORY PICKER ── */}
      {showCategoryPicker && !showCreateCategory && (
        <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => { setShowCategoryPicker(false); setSearchQuery(''); }} className="p-1 text-dark-400 hover:text-white">
              <ArrowLeft size={24} />
            </button>
            <h2 className="text-base font-bold">Categoría</h2>
            <button onClick={() => openCreateCategory(null)}
              className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center text-dark-400 hover:text-white transition-colors">
              <Settings size={16} />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 pb-3 flex-shrink-0">
            <div className="flex items-center gap-2 bg-dark-800 rounded-2xl px-4 py-2.5">
              <Search size={16} className="text-dark-400 flex-shrink-0" />
              <input type="text" placeholder="Buscar categorías" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm placeholder:text-dark-500 focus:outline-none" />
              {searchQuery && <button onClick={() => setSearchQuery('')} className="text-dark-400"><X size={14} /></button>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {q ? (
              // ── Search results — lista simple ──
              searchResults.length === 0 ? (
                <div className="text-center py-10 text-dark-500 text-sm">Sin resultados</div>
              ) : (
                <div>
                  {searchResults.map(({ cat, ancestors }) => {
                    const isActive = categoryId === cat.id;
                    return (
                      <button key={cat.id} onClick={() => handleSelectCategory(cat.id)}
                        className={`w-full flex items-center gap-3 px-5 py-3.5 border-b border-dark-800/60 transition-colors ${isActive ? 'bg-dark-800' : 'active:bg-dark-800/60'}`}>
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
                          style={{ backgroundColor: cat.color }}>{cat.icon}</div>
                        <div className="flex-1 text-left">
                          <p className="text-sm font-medium">{cat.name}</p>
                          {ancestors.length > 0 && (
                            <p className="text-xs text-dark-400">{ancestors.map(a => a.name).join(' › ')}</p>
                          )}
                        </div>
                        {isActive && <Check size={18} className="text-brand-400 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              // ── Grid view — compact 4 cols with Frecuentes section ──
              <div className="pb-8">
                {/* Frecuentes section — highlighted */}
                {frequentCats.length > 0 && (
                  <div className="mx-3 mb-3 bg-dark-800 rounded-2xl py-2.5 border border-dark-700/50">
                    <div className="px-3 pb-1.5">
                      <span className="text-[10px] font-bold text-dark-300 uppercase tracking-wider">Frecuentes</span>
                    </div>
                    <div className="grid grid-cols-5 gap-x-1 gap-y-2.5 px-2">
                      {frequentCats.map((cat) => {
                        const isActive = categoryId === cat.id;
                        return (
                          <button
                            key={`freq-${cat.id}`}
                            onClick={() => handleSelectCategory(cat.id)}
                            className="flex flex-col items-center gap-1 active:opacity-70 transition-opacity"
                          >
                            <div
                              className="rounded-full flex items-center justify-center shrink-0"
                              style={{
                                width: 42,
                                height: 42,
                                backgroundColor: cat.color,
                                fontSize: 20,
                                boxShadow: isActive ? `0 0 0 2px white, 0 0 0 4px ${cat.color}` : undefined,
                              }}
                            >
                              {cat.icon}
                            </div>
                            <span
                              className="text-center leading-tight text-dark-200 w-full"
                              style={{
                                fontSize: 10,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical' as any,
                                overflow: 'hidden',
                                wordBreak: 'break-word',
                              }}
                            >
                              {cat.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* All categories by parent */}
                {roots.map(root => {
                  const entries = flattenTree(root.children, [root]);
                  if (entries.length === 0) return null;
                  return (
                    <div key={root.id} className="mb-2">
                      <div className="px-4 pt-2 pb-1">
                        <span className="text-[10px] font-bold text-dark-400 uppercase tracking-wider">{root.name}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-x-1 gap-y-2.5 px-3">
                        {entries.map(({ cat, ancestors }) => {
                          const isActive = categoryId === cat.id;
                          const depth = ancestors.length - 1;
                          const iconSize = depth === 0 ? 42 : depth === 1 ? 38 : 34;
                          const emojiSize = depth === 0 ? 20 : depth === 1 ? 17 : 15;
                          return (
                            <button
                              key={cat.id}
                              onClick={() => handleSelectCategory(cat.id)}
                              className="flex flex-col items-center gap-1 active:opacity-70 transition-opacity"
                            >
                              <div
                                className="rounded-full flex items-center justify-center relative shrink-0"
                                style={{
                                  width: iconSize,
                                  height: iconSize,
                                  backgroundColor: cat.color,
                                  fontSize: emojiSize,
                                  boxShadow: isActive ? `0 0 0 2px white, 0 0 0 4px ${cat.color}` : undefined,
                                }}
                              >
                                {cat.icon}
                              </div>
                              <span
                                className="text-center leading-tight text-dark-200 w-full"
                                style={{
                                  fontSize: 10,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical' as any,
                                  overflow: 'hidden',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {cat.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CREATE CATEGORY ── */}
      {showCreateCategory && (
        <div className="fixed inset-0 bg-dark-900 z-[70] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => setShowCreateCategory(false)} className="p-1 text-dark-400 hover:text-white">
              <ArrowLeft size={24} />
            </button>
            <h2 className="text-base font-bold">Nueva categoría</h2>
            <div className="w-8" />
          </div>

          {/* Parent selector — all non-root cats available as parents (up to depth 2) */}
          <div className="px-5 pb-2 flex-shrink-0">
            <p className="text-xs text-dark-400 font-medium mb-2 uppercase tracking-wider">Tipo</p>
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              <button onClick={() => { setNewCatParentId(null); setNewCatIcon('📦'); setNewCatColor(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]); }}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${newCatParentId === null ? 'bg-brand-600 text-white' : 'bg-dark-700 text-dark-300'}`}>
                Principal
              </button>
              {allEntries.map(({ cat, ancestors }) => (
                <button key={cat.id} onClick={() => {
                  setNewCatParentId(cat.id);
                  setNewCatIcon(cat.icon);
                  const siblings = categories.filter(c => c.parent_id === cat.id).length;
                  setNewCatColor(deriveChildColor(cat.color, siblings));
                }}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${newCatParentId === cat.id ? 'bg-brand-600 text-white' : 'bg-dark-700 text-dark-300'}`}>
                  <span>{cat.icon}</span>
                  <span>{ancestors.length > 0 ? `${ancestors.map(a => a.name).join(' › ')} › ${cat.name}` : cat.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-8">
            <div className="flex items-center gap-4 py-5">
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl flex-shrink-0"
                style={{ backgroundColor: newCatColor }}>{newCatIcon}</div>
              <input type="text" placeholder="Nombre de categoría" value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)} autoFocus
                className="flex-1 text-lg font-semibold bg-transparent focus:outline-none border-b border-dark-700 pb-2 placeholder:text-dark-500" />
            </div>
            <div className="mb-5">
              {newCatParentId ? (
                <div className="flex items-center gap-3 py-2">
                  <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: newCatColor }} />
                  <span className="text-xs text-dark-500">Color heredado del grupo</span>
                </div>
              ) : (
                <>
                  <p className="text-xs text-dark-400 font-medium mb-2.5 uppercase tracking-wider">Color</p>
                  <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                    {CATEGORY_COLORS.map((c) => (
                      <button key={c} onClick={() => setNewCatColor(c)}
                        className={`w-8 h-8 rounded-full flex-shrink-0 transition-all ${newCatColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-dark-900 scale-110' : ''}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </>
              )}
            </div>
            <div>
              <p className="text-xs text-dark-400 font-medium mb-2.5 uppercase tracking-wider">Ícono</p>
              <div className="grid grid-cols-6 gap-2">
                {CATEGORY_ICONS.map((ic) => (
                  <button key={ic} onClick={() => setNewCatIcon(ic)}
                    className={`aspect-square rounded-xl flex items-center justify-center text-xl transition-all ${newCatIcon === ic ? 'bg-dark-600 ring-2 ring-brand-500' : 'bg-dark-800 hover:bg-dark-700'}`}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-4 py-4 bg-dark-900 border-t border-dark-800 flex-shrink-0">
            <button onClick={handleCreateCategory} disabled={!newCatName || savingCat}
              className="w-full py-4 rounded-2xl font-bold text-base transition-all disabled:opacity-30"
              style={{ backgroundColor: newCatColor, color: 'white' }}>
              {savingCat ? 'Creando...' : 'Crear categoría'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
