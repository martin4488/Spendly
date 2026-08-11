-- ============================================================================
-- 005_health_check.sql
--
-- Expone `spendly_health()`: un chequeo estructural del esquema (índices,
-- guards, migraciones aplicadas) accesible por PostgREST.
--
-- Para qué: los chequeos de verify.sql solo se pueden correr a mano desde el
-- SQL Editor, así que en la práctica se corren una vez y nunca más. Con esta
-- función, `npm test` los verifica en cada corrida junto con todo lo demás.
--
-- Seguridad: NO es security definer — corre con los permisos de quien llama y
-- solo lee catálogos (pg_indexes, pg_proc, information_schema) que en Postgres
-- ya son legibles por cualquier rol. No toca datos de usuarios. Igual se exige
-- sesión iniciada y se le saca el permiso a `anon`, así que la anon key sola no
-- alcanza para llamarla.
--
-- Devuelve solo booleanos, contadores y nombres de índices — nunca código
-- fuente ni datos.
-- ============================================================================

create or replace function public.spendly_health()
 returns json
 language plpgsql
 stable
 set search_path = public
as $function$
declare
  guarded_fns constant text[] := array[
    'get_boot_data', 'get_dashboard_data', 'get_reflect_data',
    'get_spending_overview', 'generate_recurring_expenses'
  ];
  -- Índices que 003_redundant_indexes.sql borra por duplicados.
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

    -- 001: índice que necesita generate_recurring_expenses()
    'idx_expenses_recurring', exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'idx_expenses_recurring'
    ),

    -- 001: el UPDATE de last_generated tiene que estar una sola vez (fuera del while)
    'recurring_updates_in_body', (
      select (length(prosrc) - length(replace(prosrc, 'update public.recurring_expenses', '')))
             / length('update public.recurring_expenses')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'generate_recurring_expenses'
    ),

    -- 002: sobrecarga duplicada eliminada (esperado 1)
    'reflect_overloads', (
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_reflect_data'
    ),

    -- 002: guard de auth.uid() en las 5 funciones
    'rpcs_with_guard', (
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any (guarded_fns)
        and p.prosrc like '%not authorized%'
    ),
    'rpcs_expected', array_length(guarded_fns, 1),

    -- 003: índices redundantes que todavía existen (esperado [])
    'redundant_indexes', (
      select coalesce(json_agg(indexname order by indexname), '[]'::json)
      from pg_indexes
      where schemaname = 'public' and indexname = any (redundant)
    ),

    -- Llamadores sin JWT que el guard de 002 rompería
    'pg_cron_installed', to_regclass('cron.job') is not null,
    'recurring_triggers', (
      select count(*) from information_schema.triggers
      where trigger_schema = 'public'
        and action_statement ilike '%generate_recurring%'
    )
  );
end;
$function$;

-- La anon key es pública: que haga falta sesión para introspeccionar el esquema.
revoke all on function public.spendly_health() from public;
grant execute on function public.spendly_health() to authenticated;
