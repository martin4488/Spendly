'use client';

import { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Budget, Category } from '@/types';
import { ArrowLeft, ChevronLeft, ChevronRight, Edit3, Trash2, X, Delete } from 'lucide-react';
import { format, parseISO, differenceInDays, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';

import type { BudgetPeriod } from './BudgetsView';

interface Props {
  user: User;
  budget: Budget;
  initialPeriodId: string;
  onBack: () => void;
  onRefresh: () => void;
}

// ... (mantener las interfaces ExpenseRow, CatSpend, CatNode, buildTree, allDescendantIds)

export default function BudgetDetailView({
  user,
  budget,
  initialPeriodId,
  onBack,
  onRefresh,
}: Props) {
  const [periods, setPeriods] = useState<BudgetPeriod[]>([]);
  const [currentPeriodIndex, setCurrentPeriodIndex] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [catSpending, setCatSpending] = useState<CatSpend[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit form - ahora maneja monto del período
  const [showEditForm, setShowEditForm] = useState(false);
  const [editAmount, setEditAmount] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const swipeStartX = useRef<number | null>(null);
  const now = new Date();

  useEffect(() => {
    init();
  }, [user.id, budget.id]);

  useEffect(() => {
    if (periods.length > 0) {
      loadPeriodData();
    }
  }, [currentPeriodIndex, periods, user.id, budget.id, categories]);

  async function init() {
    setLoading(true);
    setError(null);

    try {
      const [{ data: periodsData }, { data: catsData }, { data: bcData }] =
        await Promise.all([
          supabase
            .from('budget_periods')
            .select('*')
            .eq('budget_id', budget.id)
            .order('period_start', { ascending: false }),
          supabase
            .from('categories')
            .select('*')
            .eq('user_id', user.id)
            .eq('deleted', false),
          supabase.from('budget_categories').select('*').eq('budget_id', budget.id),
        ]);

      const allPeriods = periodsData || [];
      setPeriods(allPeriods);
      setCategories(catsData || []);

      const idx = allPeriods.findIndex((p) => p.id === initialPeriodId);
      setCurrentPeriodIndex(idx >= 0 ? idx : 0);
    } catch (err) {
      console.error('Error inicializando:', err);
      setError('No se pudieron cargar los datos');
    } finally {
      setLoading(false);
    }
  }

  async function loadPeriodData() {
    if (periods.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const period = periods[currentPeriodIndex];

      // ... (mantener toda la lógica de categorías, gastos, catSpending, totalSpent)

      // Después de cargar los gastos...
      // Inicializamos editAmount con el valor del período actual
      const periodAmount = period.amount ?? budget.amount;
      setEditAmount(String(periodAmount));

      // ... resto de loadPeriodData sin cambios ...
    } catch (err) {
      console.error('Error cargando período:', err);
      setError('Error al cargar los datos del período');
    } finally {
      setLoading(false);
    }
  }

  // ... (mantener navigatePeriod, onTouchStart, onTouchEnd, handleNumpad)

  async function handleSaveAmount() {
    if (!editAmount || isNaN(parseFloat(editAmount))) return;

    setSaving(true);
    try {
      const newAmount = parseFloat(editAmount);
      const currentPeriod = periods[currentPeriodIndex];

      const { error } = await supabase
        .from('budget_periods')
        .update({ amount: newAmount })
        .eq('id', currentPeriod.id);

      if (error) throw error;

      // Actualizamos localmente el período para evitar recarga completa
      setPeriods((prev) =>
        prev.map((p, i) =>
          i === currentPeriodIndex ? { ...p, amount: newAmount } : p,
        ),
      );

      setShowEditForm(false);
      onRefresh(); // opcional: refresca la lista de presupuestos si es necesario
    } catch (err) {
      console.error('Error guardando monto del período:', err);
      setError('No se pudo guardar el nuevo monto');
    } finally {
      setSaving(false);
    }
  }

  // ... (mantener handleDelete si lo quieres global o cámbialo a eliminar solo período)

  if (periods.length === 0) {
    return <div className="text-center py-10 text-dark-400">Sin períodos</div>;
  }

  const period = periods[currentPeriodIndex];
  const periodAmount = period.amount ?? budget.amount; // fallback al monto base

  const pct = periodAmount > 0 ? (totalSpent / periodAmount) * 100 : 0;
  const left = Math.max(periodAmount - totalSpent, 0);

  // ... (resto de cálculos: totalDays, daysPassed, daysLeft, perDay, timeProgress, periodLabel)

  return (
    <div className="max-w-lg mx-auto pb-8 page-transition" /* ... */>
      {/* HEADER */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        {/* ... */}
        <h1 className="text-sm font-bold truncate flex-1 text-center px-2">
          {budget.name}
        </h1>
        {/* ... */}
      </div>

      {/* NAVEGADOR DE PERÍODOS */}
      {/* ... */}

      {error ? (
        <div className="text-center py-10 text-red-400 px-4">{error}</div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* MONTO RESTANTE - ahora usa periodAmount */}
          <div className="text-center px-4 mb-4">
            <p
              className={`text-4xl font-extrabold ${
                pct >= 100 ? 'text-red-400' : 'text-brand-400'
              }`}
            >
              {formatCurrency(left)}
            </p>
            <p className="text-dark-500 text-sm mt-0.5">
              restante de {formatCurrency(periodAmount)}
            </p>
          </div>

          {/* ... resto del render sin cambios importantes ... */}

          {/* En el botón de editar */}
          <button
            onClick={() => {
              setEditAmount(String(periodAmount)); // importante: valor inicial correcto
              setShowEditForm(true);
            }}
            className="p-1.5 text-dark-400 hover:text-white"
          >
            <Edit3 size={16} />
          </button>

          {/* ... */}

          {/* FORMULARIO DE EDICIÓN */}
          {showEditForm && (
            <div className="fixed inset-0 bg-dark-900 z-[60] flex flex-col slide-up">
              {/* ... header ... */}

              <div className="px-5 py-6 flex-shrink-0 border-b border-dark-800 text-center">
                <p className="text-xs text-dark-400 mb-1">
                  Nuevo monto para {format(parseISO(period.period_start), 'MMMM yyyy', { locale: es })}
                </p>
                <p className="text-4xl font-extrabold">{editAmount || '0'}</p>
              </div>

              {/* ... numpad ... */}

              <div className="px-5 py-3">
                <button
                  onClick={handleSaveAmount}
                  disabled={saving || !editAmount || isNaN(parseFloat(editAmount))}
                  className="w-full bg-brand-600 disabled:opacity-30 text-white font-bold py-4 rounded-2xl text-base"
                >
                  {saving ? 'Guardando...' : 'Guardar para este período'}
                </button>
              </div>

              {/* ... */}
            </div>
          )}
        </>
      )}
    </div>
  );
}
