-- ============================================
-- SPENDLY — Performance Optimizations
-- Correr en Supabase SQL Editor
-- ============================================

-- 1. RPC: Dashboard data en un solo roundtrip
-- Reemplaza 2 queries separadas (expenses recientes + totales mensuales)
CREATE OR REPLACE FUNCTION get_dashboard_data(
  p_user_id uuid,
  p_recent_start text,
  p_chart_start text
)
RETURNS json AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'recent_expenses', (
      SELECT COALESCE(json_agg(row_to_json(e.*) ORDER BY e.date DESC, e.created_at DESC), '[]'::json)
      FROM expenses e
      WHERE e.user_id = p_user_id AND e.date >= p_recent_start::date
    ),
    'monthly_totals', (
      SELECT COALESCE(json_agg(json_build_object('month', m.month, 'total', m.total)), '[]'::json)
      FROM (
        SELECT to_char(e.date, 'YYYY-MM') AS month, SUM(e.amount) AS total
        FROM expenses e
        WHERE e.user_id = p_user_id AND e.date >= p_chart_start::date
        GROUP BY to_char(e.date, 'YYYY-MM')
      ) m
    )
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Index compuesto para queries de budget spending
-- Usado en BudgetsView y BudgetDetailView: .in('category_id', [...]).gte('date', ...).lte('date', ...)
CREATE INDEX IF NOT EXISTS idx_expenses_user_cat_date 
ON public.expenses(user_id, category_id, date);

-- 3. Index para global_budget_periods (consultada frecuentemente en BudgetsView)
CREATE INDEX IF NOT EXISTS idx_global_budget_periods_user 
ON public.global_budget_periods(user_id, month);
