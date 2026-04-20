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
const FREQ_KEY = 'spendly_cat_freq';
const HALF_LIFE_DAYS = 14;
const DECAY = Math.pow(0.5, 1 / HALF_LIFE_DAYS);

type FreqEntry = { s: number; t: number };
type FreqData = Record<string, FreqEntry>;

function loadFreqData(): FreqData {
  try {
    const raw = localStorage.getItem(FREQ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
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
  const scores: [string, number][] = [];
  for (const [id, entry] of Object.entries(data)) {
    const days = (now - entry.t) / 86_400_000;
    const current = entry.s * Math.pow(DECAY, days);
    if (current > 0) scores.push([id, current]);
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
  const [showCategoryPicker, setShowCategoryPicker] = useState(!editingExpense);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('📦');
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
  const [newCatParentId, setNewCatParentId] = useState<string | null>(null);
  const [savingCat, setSavingCat] = useState(false);
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

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const dateLabel = (() => {
    if (date === today) return 'Hoy';
    if (date === yesterday) return 'Ayer';
    try { return format(parseISO(date), "d MMM", { locale: es }); }
    catch { return date; }
  })();

  const amt = parseFloat(amountStr) || 0;
  const isOtherCurrency = currency !== defaultCurrency;
  const convertedAmount = isOtherCurrency ? convertCurrency(amt, currency, defaultCurrency) : null;
  const currencyInfo = CURRENCIES[currency];
  const canSave = !saving && !!amountStr && parseFloat(amountStr) > 0 && !!categoryId;

  // Format display amount: split integer and decimal parts
  const displayWhole = amountStr ? amountStr.split('.')[0] || '0' : '0';
  const displayDec = amountStr.includes('.') ? '.' + (amountStr.split('.')[1] || '') : '';
  const hasDecimals = amountStr.includes('.');

  // Save button label with amount
  const saveBtnLabel = (() => {
    if (saving) return editingExpense ? 'Guardando...' : 'Guardando...';
    if (editingExpense) {
      return amt > 0 ? `Guardar ${formatWithCurrency(amt, currency)}` : 'Guardar cambios';
    }
    return amt > 0 ? `Agregar ${formatWithCurrency(amt, currency)}` : 'Agregar gasto';
  })();

  const allEntries = flattenTree(roots);
  const q = searchQuery.trim().toLowerCase();
  const searchResults = q ? allEntries.filter(e => e.cat.name.toLowerCase().includes(q)) : [];
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

      {/* ── HEADER with gradient ── */}
      <div
        className="pt-14 pb-6 px-5 relative flex-shrink-0 text-center transition-colors duration-300"
        style={{
          background: `linear-gradient(180deg, ${headerColor} 0%, ${headerColor}dd 65%, #0f172a 100%)`,
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 p-1.5 text-white/60 hover:text-white active:scale-95 transition-all"
        >
          <X size={22} />
        </button>

        {/* Category chip */}
        <button
          onClick={() => setShowCategoryPicker(true)}
          className="inline-flex items-center gap-2 bg-white/15 rounded-full px-3.5 py-1.5 mb-5 active:bg-white/25 transition-colors"
        >
          <span className="text-lg">{headerIcon}</span>
          <span className="text-[13px] font-semibold text-white/90">{headerName}</span>
          <ChevronDown size={13} className="text-white/50" />
        </button>

        {/* Hero amount */}
        <div className="mb-2">
          <span className="text-[54px] leading-none font-light text-white tracking-tight">
            {displayWhole}
          </span>
          {hasDecimals && (
            <span className="text-[54px] leading-none font-light text-white/30 tracking-tight">
              {displayDec}
            </span>
          )}
          {!amountStr && (
            <span className="text-[54px] leading-none font-light text-white/20 tracking-tight">0</span>
          )}
          <span className="text-sm font-medium text-white/40 ml-1.5 align-top relative top-3">
            {currency}
          </span>
        </div>

        {/* Converted amount hint */}
        {isOtherCurrency && convertedAmount !== null && amt > 0 && (
          <p className="text-white/35 text-xs mb-2">
            ≈ {formatWithCurrency(convertedAmount, defaultCurrency)}
          </p>
        )}

        {/* Description input inline */}
        <input
          type="text"
          placeholder="Agregar nota..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="bg-transparent border-none outline-none text-center text-sm text-white/50 placeholder:text-white/25 w-full px-8 mb-4"
        />

        {/* Date + Currency chips */}
        <div className="flex items-center justify-center gap-2.5">
          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/15 rounded-full px-3 py-1.5 active:scale-95 transition-all"
          >
            <Calendar size={13} className="text-white/60" />
            <span className="text-xs font-medium text-white/70 capitalize">{dateLabel}</span>
          </button>

          {date === today && (
            <button
              onClick={() => setDate(yesterday)}
              className="text-[11px] text-white/30 border border-dashed border-white/15 rounded-full px-2.5 py-1 hover:text-white/50 hover:border-white/25 transition-colors"
            >
              Ayer?
            </button>
          )}

          <button
            onClick={() => setShowCurrencyPicker(true)}
            className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/15 rounded-full px-3 py-1.5 active:scale-95 transition-all"
          >
            <span className="text-sm">{currencyInfo.flag}</span>
            <span className="text-xs font-medium text-white/70">{currency}</span>
            <ChevronDown size={11} className="text-white/40" />
          </button>
        </div>
      </div>

      {/* ── Date picker (expandable) ── */}
      {showDatePicker && (
        <div className="px-5 py-3 bg-dark-800/50 flex-shrink-0">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              const v = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { setDate(v); setShowDatePicker(false); }
            }}
            className="w-full bg-dark-700 border border-dark-600 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors"
          />
        </div>
      )}

      {/* ── Spacer to push bottom to bottom ── */}
      <div className="flex-1" />

      {/* ── BOTTOM: Save button + Numpad ── */}
      <div className="flex-shrink-0">
        {/* Save button */}
        <div className="px-5 py-3">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full py-4 rounded-2xl font-bold text-[15px] transition-all duration-200 disabled:opacity-30 active:scale-[0.98]"
            style={{
              backgroundColor: headerColor,
              color: 'white',
              boxShadow: canSave ? `0 4px 24px ${headerColor}40` : 'none',
            }}
          >
            {saveBtnLabel}
          </button>
        </div>

        {/* Numpad — gapped rounded keys */}
        <div className="px-2 pb-1">
          <div className="grid grid-cols-3 gap-[6px]">
            {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map((key) => {
              const isDel = key === 'backspace';
              const isDot = key === '.';
              return (
                <button
                  key={key}
                  onClick={() => isDel ? handleNumpad('backspace') : handleNumpad(key)}
                  className="py-[15px] text-center text-[22px] font-normal rounded-xl active:scale-95 active:bg-dark-600 transition-all duration-100 bg-dark-800/60 text-white"
                >
                  {isDel ? (
                    <span className="flex items-center justify-center">
                      <Delete size={21} className="text-white/50" />
                    </span>
                  ) : isDot ? (
                    <span className="text-white/40">.</span>
                  ) : (
                    key
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
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
              <div className="pb-8">
                {/* Frecuentes */}
                {frequentCats.length > 0 && (
                  <div className="mx-1.5 mb-3 bg-dark-800 rounded-2xl pt-2.5 pb-3 border border-dark-700/50">
                    <div className="px-3 pb-1.5">
                      <span className="text-[10px] font-bold text-dark-300 uppercase tracking-wider">Frecuentes</span>
                    </div>
                    <div className="grid grid-cols-5 gap-x-1 gap-y-2.5 px-1.5">
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
                              className="text-center leading-tight text-dark-200 font-medium w-full"
                              style={{
                                fontSize: 11,
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
                                className="text-center leading-tight text-dark-200 font-medium w-full"
                                style={{
                                  fontSize: 11,
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
