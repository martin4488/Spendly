-- ============================================================================
-- 004_fix_date_casts.sql
--
-- Correr después de 002. Arregla dos funciones que comparan una columna `date`
-- contra un parámetro `text` sin castear:
--
--     WHERE ... AND date >= p_year_start    -- p_year_start es text
--
-- En Postgres no existe el operador `date >= text` y no hay cast implícito, así
-- que la función explota en runtime con:
--
--     ERROR: 42883: operator does not exist: date >= text
--
-- Cómo pasó desapercibido:
--
--   · get_reflect_data tenía DOS sobrecargas, (uuid,text,text) y (uuid,date,date).
--     La de text siempre estuvo rota; PostgREST resolvía a la de date, que
--     andaba bien. 002 borró la de date "por duplicada" y dejó la rota.
--
--   · get_spending_overview tiene el mismo bug y NO tenía sobrecarga que la
--     tapara: viene fallando en producción desde siempre. SpendingOverview cae
--     al fallback del cliente (traer todos los gastos del período y agregarlos
--     en JS) y por eso nunca se vio un error — solo era más lenta.
--
-- El fix es `::date` en los parámetros, igual que ya hacían get_boot_data y
-- get_dashboard_data. Se mantiene el guard de auth de 002.
--
-- Verificar después: bloque C de verify.sql, o `npm test` con .env.local.
-- ============================================================================

create or replace function public.get_reflect_data(p_user_id uuid, p_year_start text, p_year_end text)
 returns json
 language plpgsql
 security definer
 set search_path = public
as $function$
DECLARE
  result JSON;
  v_start date := p_year_start::date;   -- ← castear una vez, arriba
  v_end   date := p_year_end::date;
BEGIN
  IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'monthly_totals', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.month), '[]'::json)
      FROM (
        SELECT TO_CHAR(date, 'YYYY-MM') AS month, SUM(amount) AS total
        FROM expenses
        WHERE user_id = p_user_id AND date >= v_start AND date <= v_end
        GROUP BY TO_CHAR(date, 'YYYY-MM')
      ) t
    ),
    'category_totals', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT category_id, TO_CHAR(date, 'YYYY-MM') AS month, SUM(amount) AS total
        FROM expenses
        WHERE user_id = p_user_id AND date >= v_start AND date <= v_end
          AND category_id IS NOT NULL
        GROUP BY category_id, TO_CHAR(date, 'YYYY-MM')
      ) t
    )
  ) INTO result;

  RETURN result;
END;
$function$;

create or replace function public.get_spending_overview(p_user_id uuid, p_start_date text, p_end_date text)
 returns json
 language plpgsql
 security definer
 set search_path = public
as $function$
DECLARE
  result JSON;
  v_start date := p_start_date::date;
  v_end   date := p_end_date::date;
BEGIN
  IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'category_totals', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT category_id, SUM(amount) AS total, COUNT(*) AS tx_count
        FROM expenses
        WHERE user_id = p_user_id AND date >= v_start AND date <= v_end
        GROUP BY category_id
      ) t
    ),
    'total', (
      SELECT COALESCE(SUM(amount), 0)
      FROM expenses
      WHERE user_id = p_user_id AND date >= v_start AND date <= v_end
    )
  ) INTO result;

  RETURN result;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Nota sobre el índice
-- ─────────────────────────────────────────────────────────────────────────────
-- Comparar contra una variable `date` en vez de text también permite que el
-- planner use idx_expenses_user_date / idx_expenses_user_date_cat, cosa que con
-- el operador roto ni siquiera llegaba a evaluarse.
