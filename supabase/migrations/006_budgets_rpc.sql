-- ============================================================================
-- 006_budgets_rpc.sql
--
-- BudgetsView era la única vista sin RPC: armaba su pantalla con seis consultas
-- en TRES tandas encadenadas (budgets → periods+categorías → gastos), más un
-- INSERT condicional en el medio, y después sumaba el gasto por presupuesto en
-- el cliente recorriendo todos los gastos de todas las categorías del árbol.
--
-- `get_budgets_data` devuelve todo eso en una sola llamada, con las sumas ya
-- hechas en Postgres.
--
-- ⚠ ESCRIBE. Es la única función `get_*` que no es de solo lectura: materializa
--   los períodos que falten hasta hoy, igual que hacía el cliente. Tiene que
--   pasar acá adentro, antes de agregar: si no, el primer día de un mes nuevo el
--   período actual todavía no existe y el presupuesto aparecería vacío.
--   Es idempotente (no toca un período que ya está).
--
-- ⚠ `p_today` lo manda el cliente. NO uses current_date acá: el servidor está en
--   UTC y a partir de las 21:00 de Argentina ya es el día siguiente, que es
--   exactamente la clase de bug que arregla src/lib/dateUtils.ts.
--
-- Riesgo: bajo. Es una función nueva; si no existe o falla, BudgetsView cae al
-- camino viejo (que sigue entero en el código) y sólo se pone lenta.
--
-- Después de correr esto: `npm test` con .env.local configurado, y el BLOQUE C
-- de verify.sql.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Un período por (presupuesto, fecha de inicio)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hoy nada lo impide: si dos dispositivos abren Budgets al mismo tiempo el
-- primer día del mes, los dos generan el mismo período y quedan duplicados.
-- El índice hace que el `on conflict do nothing` de abajo sea de verdad.
--
-- Si ya hay duplicados no se puede crear, así que sólo lo intenta cuando está
-- limpio y avisa si no. En ese caso el INSERT igual filtra por `not exists`,
-- que es exactamente lo que hacía el cliente — no se rompe nada.
do $$
begin
  if exists (
    select 1 from public.budget_periods
    group by budget_id, period_start having count(*) > 1
  ) then
    raise notice 'budget_periods tiene períodos duplicados: se saltea el índice único. Mirá el BLOQUE F de verify.sql.';
  else
    create unique index if not exists idx_budget_periods_unique
      on public.budget_periods (budget_id, period_start);
  end if;
end
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_budgets_data
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_budgets_data(p_user_id uuid, p_today text)
 returns json
 language plpgsql
 security definer
 set search_path = public
as $function$
DECLARE
  v_today      date;
  v_year_start date;
  v_month_end  date;
  result       json;
BEGIN
  -- Mismo guard que el resto de las RPCs (migración 002): son SECURITY DEFINER,
  -- saltean RLS, y la anon key es pública.
  IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  v_today      := p_today::date;
  -- ::timestamp explícito en todos los date_trunc de acá abajo. Sin el cast,
  -- date_trunc(text, date) resuelve a la sobrecarga de timestamptz (timestamptz
  -- es el tipo preferido de la categoría) y el resultado pasa a depender del
  -- TimeZone de la sesión. Con timestamp a secas no depende de nada.
  v_year_start := date_trunc('year',  v_today::timestamp)::date;
  v_month_end  := (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date;

  -- ── Materializar los períodos faltantes ───────────────────────────────────
  -- Un período por mes (o año) calendario desde el mes de `start_date` hasta el
  -- de hoy. El tope de 120 es el mismo que tenía el bucle del cliente: acota lo
  -- que puede generar un presupuesto con una fecha de inicio absurda.
  --
  -- El monto sale del período más reciente que tenga uno, para que un mes nuevo
  -- herede lo que venía valiendo el presupuesto (idéntico al cliente).
  INSERT INTO budget_periods (budget_id, period_start, period_end, amount)
  SELECT b.id, g.p_start, g.p_end, la.amount
  FROM budgets b
  CROSS JOIN LATERAL (
    SELECT
      s::date AS p_start,
      (s + CASE WHEN b.recurrence = 'monthly' THEN interval '1 month' ELSE interval '1 year' END
         - interval '1 day')::date AS p_end
    FROM generate_series(
      CASE WHEN b.recurrence = 'monthly'
           THEN date_trunc('month', b.start_date::timestamp)
           ELSE date_trunc('year',  b.start_date::timestamp) END,
      CASE WHEN b.recurrence = 'monthly'
           THEN least(date_trunc('month', v_today::timestamp),
                      date_trunc('month', b.start_date::timestamp) + interval '120 months')
           ELSE least(date_trunc('year',  v_today::timestamp),
                      date_trunc('year',  b.start_date::timestamp) + interval '120 years') END,
      CASE WHEN b.recurrence = 'monthly' THEN interval '1 month' ELSE interval '1 year' END
    ) s
  ) g
  LEFT JOIN LATERAL (
    SELECT bp.amount
    FROM budget_periods bp
    WHERE bp.budget_id = b.id AND bp.amount IS NOT NULL
    ORDER BY bp.period_start DESC
    LIMIT 1
  ) la ON true
  WHERE b.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM budget_periods bp
      WHERE bp.budget_id = b.id AND bp.period_start = g.p_start
    )
  ON CONFLICT DO NOTHING;

  -- ── El payload ────────────────────────────────────────────────────────────
  -- RECURSIVE por `expanded`; el resto de los CTE son normales.
  WITH RECURSIVE
  -- Categorías asignadas al presupuesto (las filas vigentes).
  seeds AS (
    SELECT bcp.budget_id, bcp.category_id
    FROM budget_category_periods bcp
    JOIN budgets b ON b.id = bcp.budget_id
    WHERE b.user_id = p_user_id AND bcp.valid_to IS NULL
  ),
  -- ...más todas sus descendientes. El cliente hace lo mismo caminando el árbol
  -- que ya tiene en memoria; acá es un CTE recursivo. `union` (no `union all`)
  -- corta cualquier ciclo. Las borradas quedan afuera, igual que en el cliente,
  -- que expande sobre el árbol de `getCategories()`.
  expanded AS (
    SELECT budget_id, category_id FROM seeds
    UNION
    SELECT e.budget_id, c.id
    FROM expanded e
    JOIN categories c ON c.parent_id = e.category_id
    WHERE c.user_id = p_user_id AND c.deleted IS DISTINCT FROM TRUE
  ),
  -- Sólo los períodos que la vista mira: el que corre hoy y los ya cerrados de
  -- este año, que son los que alimentan el acumulado. Los viejos no se suman.
  live_periods AS (
    SELECT bp.id, bp.budget_id, bp.period_start, bp.period_end, bp.amount
    FROM budget_periods bp
    JOIN budgets b ON b.id = bp.budget_id
    WHERE b.user_id = p_user_id
      AND bp.period_end >= v_year_start
      AND bp.period_start <= v_today
  ),
  period_spend AS (
    SELECT
      lp.id,
      lp.budget_id,
      lp.period_start,
      lp.period_end,
      lp.amount,
      COALESCE((
        SELECT SUM(e.amount)
        FROM expenses e
        JOIN expanded x ON x.category_id = e.category_id AND x.budget_id = lp.budget_id
        WHERE e.user_id = p_user_id
          AND e.date BETWEEN lp.period_start AND lp.period_end
      ), 0) AS spent
    FROM live_periods lp
  )
  SELECT json_build_object(
    -- 1. Los presupuestos, con sus categorías asignadas (las semillas, no las
    --    expandidas: es lo que muestra la lista y lo que edita el formulario).
    'budgets', (
      SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.name), '[]'::json)
      FROM (
        SELECT
          b.id, b.user_id, b.name, b.amount, b.currency, b.recurrence,
          b.start_date, b.created_at, b.updated_at,
          COALESCE(
            (SELECT json_agg(s.category_id) FROM seeds s WHERE s.budget_id = b.id),
            '[]'::json
          ) AS category_ids
        FROM budgets b
        WHERE b.user_id = p_user_id
      ) x
    ),
    -- 2. Los períodos vivos con el gasto ya sumado.
    'periods', (
      SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.period_start), '[]'::json)
      FROM period_spend p
    ),
    -- 3. El presupuesto global mes a mes.
    'global_periods', (
      SELECT COALESCE(json_agg(json_build_object('month', month, 'amount', amount) ORDER BY month), '[]'::json)
      FROM global_budget_periods
      WHERE user_id = p_user_id
    ),
    -- 4. Gasto total por mes en lo que va del año (todas las categorías) — es
    --    lo que necesita el widget global y el excedente acumulado.
    'monthly_totals', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.month), '[]'::json)
      FROM (
        SELECT TO_CHAR(date, 'YYYY-MM') AS month, SUM(amount) AS total
        FROM expenses
        WHERE user_id = p_user_id
          AND date >= v_year_start
          AND date <= v_month_end
        GROUP BY TO_CHAR(date, 'YYYY-MM')
      ) t
    )
  ) INTO result;

  RETURN result;
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Que `npm test` sepa si esto quedó aplicado
-- ─────────────────────────────────────────────────────────────────────────────
-- Misma función de 005, con `get_budgets_data` sumada a las que tienen que
-- llevar el guard, más dos campos nuevos sobre los períodos duplicados.
create or replace function public.spendly_health()
 returns json
 language plpgsql
 stable
 set search_path = public
as $function$
declare
  guarded_fns constant text[] := array[
    'get_boot_data', 'get_dashboard_data', 'get_reflect_data',
    'get_spending_overview', 'generate_recurring_expenses', 'get_budgets_data'
  ];
  redundant constant text[] := array[
    'idx_global_budget_periods_user',
    'idx_global_budget_periods_user_month',
    'idx_user_settings_user',
    'idx_budget_categories_budget',
    'idx_budget_category_periods_budget'
  ];
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return json_build_object(
    'idx_expenses_recurring', exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'idx_expenses_recurring'
    ),
    'recurring_updates_in_body', (
      select (length(prosrc) - length(replace(prosrc, 'update public.recurring_expenses', '')))
             / length('update public.recurring_expenses')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'generate_recurring_expenses'
    ),
    'reflect_overloads', (
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_reflect_data'
    ),
    'rpcs_with_guard', (
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any (guarded_fns)
        and p.prosrc like '%not authorized%'
    ),
    'rpcs_expected', array_length(guarded_fns, 1),
    'redundant_indexes', (
      select coalesce(json_agg(indexname order by indexname), '[]'::json)
      from pg_indexes
      where schemaname = 'public' and indexname = any (redundant)
    ),
    'pg_cron_installed', to_regclass('cron.job') is not null,
    'recurring_triggers', (
      select count(*) from information_schema.triggers
      where trigger_schema = 'public'
        and action_statement ilike '%generate_recurring%'
    ),

    -- 006: BudgetsView ya no depende de seis consultas sueltas
    'has_budgets_rpc', exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_budgets_data'
    ),
    -- 006: el índice que hace que dos dispositivos no generen el mismo período
    'idx_budget_periods_unique', exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'idx_budget_periods_unique'
    ),
    -- Si esto no es 0, el índice de arriba no se pudo crear: hay que limpiar
    -- los duplicados a mano (BLOQUE F de verify.sql).
    'budget_period_duplicates', (
      select count(*) from (
        select 1 from public.budget_periods
        group by budget_id, period_start having count(*) > 1
      ) d
    )
  );
end;
$function$;

revoke all on function public.spendly_health() from public;
grant execute on function public.spendly_health() to authenticated;
