'use client';

import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Category } from '@/types';
import { CURRENCIES, convertCurrency, formatWithCurrency, CurrencyCode } from '@/lib/currency';
import { CATEGORY_ICONS, CATEGORY_COLORS } from '@/lib/utils';
import { X, Calendar, Delete, ChevronDown, Settings, Check, ArrowLeft } from 'lucide-react';
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

export default function AddExpenseModal({ user, defaultCurrency, onClose, onSaved, editingExpense }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [amountStr, setAmountStr] = useState(
    editingExpense
      ? String(editingExpense.original_amount || editingExpense.amount)
      : ''
  );
  const [description, setDescription] = useState(editingExpense?.description || '');
  const [categoryId, setCategoryId] = useState(editingExpense?.category_id || '');
  const [date, setDate] = useState(editingExpense?.date || new Date().toISOString().split('T')[0]);
  const [currency, setCurrency] = useState<CurrencyCode>(
    (editingExpense?.original_currency as CurrencyCode) || defaultCurrency
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [btnBottom, setBtnBottom] = useState(0);

  // Use visualViewport to position button above keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      if (!vv) return;
      // visualViewport.height is the visible area (excluding keyboard)
      // We position the button at the bottom of the visible area
      const bottom = window.innerHeight - (vv.height + vv.offsetTop);
      setBtnBottom(bottom > 50 ? bottom + 44 : 0);
    }

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // Create category inline
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('📦');
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
  const [savingCat, setSavingCat] = useState(false);

  useEffect(() => {
    supabase
      .from('categories')
      .select('*')
      .eq('user_id', user.id)
      .order('name')
      .then(({ data }) => setCategories(data || []));
  }, [user.id]);

  const selectedCat = categories.find(c => c.id === categoryId);
  const parentCats = categories.filter(c => !c.parent_id);
  const getSubcats = (pid: string) => categories.filter(c => c.parent_id === pid);

  const headerColor = selectedCat?.color || '#475569';
  const headerIcon = selectedCat?.icon || '💵';
  const headerName = selectedCat?.name || 'Sin categoría';
  const displayAmount = amountStr || '0';

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const dateLabel = date === today ? 'Hoy' : date === yesterday ? 'Ayer' : format(parseISO(date), "d 'de' MMM yyyy", { locale: es });

  // Converted amount preview
  const amt = parseFloat(amountStr) || 0;
  const isOtherCurrency = currency !== defaultCurrency;
  const convertedAmount = isOtherCurrency ? convertCurrency(amt, currency, defaultCurrency) : null;

  const currencyInfo = CURRENCIES[currency];

  function handleNumpad(key: string) {
    if (key === 'backspace') {
      setAmountStr(prev => prev.slice(0, -1));
    } else if (key === '.') {
      if (!amountStr.includes('.')) {
        setAmountStr(prev => (prev || '0') + '.');
      }
    } else {
      if (amountStr.includes('.')) {
        const decimals = amountStr.split('.')[1];
        if (decimals && decimals.length >= 2) return;
      }
      setAmountStr(prev => prev + key);
    }
  }

  async function handleCreateCategory() {
    if (!newCatName) return;
    setSavingCat(true);
    try {
      const { data } = await supabase.from('categories').insert({
        user_id: user.id,
        name: newCatName,
        icon: newCatIcon,
        color: newCatColor,
      }).select().single();

      if (data) {
        // Refresh categories and select the new one
        const { data: cats } = await supabase
          .from('categories')
          .select('*')
          .eq('user_id', user.id)
          .order('name');
        setCategories(cats || []);
        setCategoryId(data.id);
      }
      setShowCreateCategory(false);
      setNewCatName('');
      setNewCatIcon('📦');
      setNewCatColor(CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingCat(false);
    }
  }

  async function handleSave() {
    const amt = parseFloat(amountStr);
    if (!amt || amt <= 0) return;
    setSaving(true);

    // Calculate final amount in default currency
    let finalAmount = amt;
    let originalCurrency: string | null = null;
    let originalAmount: number | null = null;

    if (isOtherCurrency) {
      const converted = convertCurrency(amt, currency, defaultCurrency);
      if (converted !== null) {
        finalAmount = converted;
        originalCurrency = currency;
        originalAmount = amt;
      }
    }

    const data = {
      user_id: user.id,
      amount: finalAmount,
      description: description || headerName,
      notes: null,
      category_id: categoryId || null,
      date,
      original_currency: originalCurrency,
      original_amount: originalAmount,
    };

    try {
      if (editingExpense) {
        await supabase.from('expenses').update(data).eq('id', editingExpense.id);
      } else {
        await supabase.from('expenses').insert(data);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-dark-900">
      {/* ===== HEADER with category color ===== */}
      <div className="pt-12 pb-5 px-5 relative flex-shrink-0" style={{ backgroundColor: headerColor }}>
        <button onClick={onClose} className="absolute top-4 left-4 p-1 text-white/80 hover:text-white">
          <X size={24} />
        </button>

        <p className="text-center text-white/90 text-sm font-semibold mb-4">
          {editingExpense ? 'Editar gasto' : `Agregar ${headerName}`}
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowCategoryPicker(true)}
            className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl"
          >
            {headerIcon}
          </button>

          <div className="text-right">
            <div className="flex items-center justify-end gap-2">
              <span className="text-3xl font-extrabold text-white">-{displayAmount}</span>
              {/* Currency selector button */}
              <button
                onClick={() => setShowCurrencyPicker(true)}
                className="flex items-center gap-0.5 bg-white/20 rounded-full px-2 py-1 text-white/90"
              >
                <span className="text-xs font-semibold">{currencyInfo.symbol}</span>
                <ChevronDown size={12} />
              </button>
            </div>
            {/* Show conversion preview */}
            {isOtherCurrency && convertedAmount !== null && amt > 0 && (
              <p className="text-white/50 text-xs mt-0.5">
                ≈ {formatWithCurrency(convertedAmount, defaultCurrency)}
              </p>
            )}
            {!isOtherCurrency && (
              <p className="text-white/60 text-xs mt-0.5">{currency}</p>
            )}
          </div>
        </div>
      </div>

      {/* ===== FORM FIELDS (scrollable middle) ===== */}
      <div className="flex-1 overflow-y-auto">
        {/* Date */}
        <button
          onClick={() => setShowDatePicker(!showDatePicker)}
          className="flex items-center gap-3 px-5 py-4 border-b border-dark-800 w-full"
        >
          <Calendar size={18} className="text-dark-400" />
          <span className="text-sm font-medium flex-1 text-left capitalize">{dateLabel}</span>
          {date === today && (
            <span
              onClick={(e) => { e.stopPropagation(); setDate(yesterday); }}
              className="text-xs text-dark-500 border border-dashed border-dark-600 rounded-full px-3 py-1"
            >
              Ayer?
            </span>
          )}
        </button>

        {showDatePicker && (
          <div className="px-5 py-3 border-b border-dark-800 bg-dark-800/50">
            <input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setShowDatePicker(false); }}
              className="w-full bg-dark-700 border border-dark-600 rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
        )}

        {/* Description */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-dark-800">
          <span className="text-dark-400 text-lg">✏️</span>
          <input
            type="text"
            placeholder="Descripción"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onFocus={() => setIsTyping(true)}
            onBlur={() => setIsTyping(false)}
            enterKeyHint="done"
            className="flex-1 bg-transparent text-sm placeholder:text-dark-500 focus:outline-none"
          />
        </div>
      </div>

      {/* ===== BOTTOM SECTION ===== */}
      {isTyping && btnBottom > 0 ? (
        /* Floating button positioned above keyboard */
        <div
          className="fixed left-0 right-0 z-[70]"
          style={{ bottom: `${btnBottom}px` }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              handleSave();
            }}
            disabled={saving || !amountStr || parseFloat(amountStr) <= 0}
            className="w-full py-4 font-bold text-base transition-all disabled:opacity-40"
            style={{ backgroundColor: headerColor, color: 'white' }}
          >
            {saving ? 'Guardando...' : editingExpense ? 'Guardar cambios' : 'Agregar gasto'}
          </button>
        </div>
      ) : isTyping ? (
        /* Fallback when btnBottom not ready yet */
        <div className="fixed left-0 right-0 bottom-0 z-[70]">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              handleSave();
            }}
            disabled={saving || !amountStr || parseFloat(amountStr) <= 0}
            className="w-full py-4 font-bold text-base transition-all disabled:opacity-40"
            style={{ backgroundColor: headerColor, color: 'white' }}
          >
            {saving ? 'Guardando...' : editingExpense ? 'Guardar cambios' : 'Agregar gasto'}
          </button>
        </div>
      ) : (
        /* Normal: rounded button + numpad */
        <div className="flex-shrink-0">
          <div className="px-5 py-3">
            <button
              onClick={handleSave}
              disabled={saving || !amountStr || parseFloat(amountStr) <= 0}
              className="w-full py-4 rounded-2xl font-bold text-base transition-all disabled:opacity-40"
              style={{ backgroundColor: headerColor, color: 'white' }}
            >
              {saving ? 'Guardando...' : editingExpense ? 'Guardar cambios' : 'Agregar gasto'}
            </button>
          </div>
          <div className="border-t border-dark-700">
            <div className="grid grid-cols-3">
              {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map((key) => {
                const isDel = key === 'backspace';
                return (
                  <button
                    key={key}
                    onClick={() => {
                      if (isDel) handleNumpad('backspace');
                      else handleNumpad(key);
                    }}
                    className="py-[14px] text-center text-xl font-medium border-b border-r border-dark-800 active:bg-dark-700 transition-colors bg-dark-900 text-white"
                  >
                    {isDel ? <span className="flex items-center justify-center"><Delete size={22} /></span> : key}
                  </button>
                );
              })}
            </div>
            <div className="h-[env(safe-area-inset-bottom)]" />
          </div>
        </div>
      )}

      {/* ===== CURRENCY PICKER ===== */}
      {showCurrencyPicker && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end">
          <div className="bg-dark-800 w-full rounded-t-3xl slide-up">
            <div className="flex items-center justify-between p-4 border-b border-dark-700">
              <h3 className="text-base font-bold">Moneda</h3>
              <button onClick={() => setShowCurrencyPicker(false)} className="p-1 text-dark-400">
                <X size={20} />
              </button>
            </div>
            {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => {
              const c = CURRENCIES[code];
              const isActive = currency === code;
              return (
                <button
                  key={code}
                  onClick={() => { setCurrency(code); setShowCurrencyPicker(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-4 border-b border-dark-700/30 active:bg-dark-700/50 transition-colors ${isActive ? 'bg-dark-700/30' : ''}`}
                >
                  <span className="text-2xl">{c.flag}</span>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-dark-400">{c.code} · {c.symbol}</p>
                  </div>
                  {isActive && (
                    <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
            <div className="h-8" />
          </div>
        </div>
      )}

      {/* ===== CATEGORY PICKER OVERLAY - Grid style ===== */}
      {showCategoryPicker && !showCreateCategory && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end">
          <div className="bg-dark-800 w-full rounded-t-3xl max-h-[75vh] overflow-y-auto slide-up">
            <div className="flex items-center justify-between p-4 border-b border-dark-700 sticky top-0 bg-dark-800 z-10">
              <h3 className="text-base font-bold">Categoría</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCreateCategory(true)}
                  className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center text-dark-400 hover:text-white transition-colors"
                >
                  <Settings size={16} />
                </button>
                <button
                  onClick={() => setShowCategoryPicker(false)}
                  className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center text-dark-400 hover:text-white transition-colors"
                >
                  <Check size={16} />
                </button>
              </div>
            </div>

            <div className="p-4 grid grid-cols-4 gap-3">
              {/* Sin categoría */}
              <button
                onClick={() => { setCategoryId(''); setShowCategoryPicker(false); }}
                className="flex flex-col items-center gap-1.5"
              >
                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all ${
                  !categoryId ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-dark-800' : ''
                } bg-dark-600`}>
                  💵
                </div>
                <span className="text-[10px] text-dark-300 text-center leading-tight">Sin cat.</span>
              </button>

              {parentCats.map((cat) => {
                const isActive = categoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => { setCategoryId(cat.id); setShowCategoryPicker(false); }}
                    className="flex flex-col items-center gap-1.5"
                  >
                    <div
                      className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all ${
                        isActive ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-dark-800' : ''
                      }`}
                      style={{ backgroundColor: cat.color + '25' }}
                    >
                      {cat.icon}
                    </div>
                    <span className="text-[10px] text-dark-300 text-center leading-tight truncate w-full">{cat.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Subcategories section */}
            {parentCats.some(c => getSubcats(c.id).length > 0) && (
              <div className="px-4 pb-4">
                <p className="text-[10px] text-dark-500 uppercase tracking-wider font-semibold mb-2">Subcategorías</p>
                <div className="grid grid-cols-4 gap-3">
                  {parentCats.flatMap((cat) =>
                    getSubcats(cat.id).map((sub) => {
                      const isActive = categoryId === sub.id;
                      return (
                        <button
                          key={sub.id}
                          onClick={() => { setCategoryId(sub.id); setShowCategoryPicker(false); }}
                          className="flex flex-col items-center gap-1.5"
                        >
                          <div
                            className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all ${
                              isActive ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-dark-800' : ''
                            }`}
                            style={{ backgroundColor: (sub.color || cat.color) + '25' }}
                          >
                            {sub.icon}
                          </div>
                          <span className="text-[10px] text-dark-400 text-center leading-tight truncate w-full">{sub.name}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
            <div className="h-4" />
          </div>
        </div>
      )}

      {/* ===== INLINE CREATE CATEGORY ===== */}
      {showCreateCategory && (
        <div className="fixed inset-0 bg-dark-900 z-[70] flex flex-col slide-up">
          <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
            <button onClick={() => setShowCreateCategory(false)} className="p-1 text-dark-400 hover:text-white">
              <ArrowLeft size={24} />
            </button>
            <h2 className="text-base font-bold">Nueva categoría</h2>
            <div className="w-8" />
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-8">
            {/* Preview */}
            <div className="flex items-center gap-4 py-5">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-3xl flex-shrink-0"
                style={{ backgroundColor: newCatColor }}
              >
                {newCatIcon}
              </div>
              <input
                type="text"
                placeholder="Nombre de categoría"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className="flex-1 text-lg font-semibold bg-transparent focus:outline-none border-b border-dark-700 pb-2 placeholder:text-dark-500"
              />
            </div>

            {/* Color picker */}
            <div className="mb-5">
              <p className="text-xs text-dark-400 font-medium mb-2.5 uppercase tracking-wider">Color</p>
              <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewCatColor(c)}
                    className={`w-8 h-8 rounded-full flex-shrink-0 transition-all ${
                      newCatColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-dark-900 scale-110' : ''
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Icon picker */}
            <div>
              <p className="text-xs text-dark-400 font-medium mb-2.5 uppercase tracking-wider">Ícono</p>
              <div className="grid grid-cols-6 gap-2">
                {CATEGORY_ICONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => setNewCatIcon(ic)}
                    className={`aspect-square rounded-xl flex items-center justify-center text-xl transition-all ${
                      newCatIcon === ic
                        ? 'bg-dark-600 ring-2 ring-brand-500'
                        : 'bg-dark-800 hover:bg-dark-700'
                    }`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Create button */}
          <div className="px-4 py-4 bg-dark-900 border-t border-dark-800 flex-shrink-0">
            <button
              onClick={handleCreateCategory}
              disabled={!newCatName || savingCat}
              className="w-full py-4 rounded-2xl font-bold text-base transition-all disabled:opacity-30"
              style={{ backgroundColor: newCatColor, color: 'white' }}
            >
              {savingCat ? 'Creando...' : 'Crear categoría'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
