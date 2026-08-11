-- ============================================================================
-- verify.sql — chequeo post-migración
--
-- ⚠ CORRER DE A UN BLOQUE. No seleccionar todo el archivo:
--     · el editor de Supabase solo muestra el resultado del último statement
--     · el bloque D TIENE que dar error, y eso abortaría el resto
--   En el SQL Editor: seleccionás las líneas de un bloque y le das Run.
--
-- No hace falta editar nada: el usuario se deduce solo (el que tiene más
-- gastos, o el más viejo de auth.users si no hay ninguno).
--
-- No modifica datos: lo que escribe va dentro de una transacción con rollback.
-- ============================================================================


-- ═══ BLOQUE A — Estructura: ¿quedó aplicado lo que esperábamos? ══════════════
select
  (select count(*) from pg_indexes
     where schemaname = 'public' and indexname = 'idx_expenses_recurring')      as idx_recurring_existe,   -- espera 1
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_reflect_data')             as reflect_sobrecargas,    -- espera 1
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_boot_data','get_dashboard_data','get_reflect_data',
                         'get_spending_overview','generate_recurring_expenses')
       and p.prosrc like '%not authorized%')                                    as funciones_con_guard;    -- espera 5


-- ═══ BLOQUE B — ¿el UPDATE quedó fuera del while? ════════════════════════════
-- Espera: tiene_last_date = true, updates_en_el_cuerpo = 1
select
  prosrc like '%last_date%'                                          as tiene_last_date,
  (length(prosrc) - length(replace(prosrc, 'update public.recurring_expenses', '')))
    / length('update public.recurring_expenses')                     as updates_en_el_cuerpo
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'generate_recurring_expenses';


-- ═══ BLOQUE C — LA IMPORTANTE: las RPCs con un JWT simulado ══════════════════
-- Sin esto no sabés si el guard rompió la app: cuando get_boot_data falla,
-- page.tsx cae al camino lento y no se queja.
-- Todas las columnas tienen que dar 'object'; uid no puede ser null.
begin;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', coalesce(
      (select user_id from public.expenses group by user_id order by count(*) desc limit 1),
      (select id from auth.users order by created_at limit 1)
    ),
    'role', 'authenticated'
  )::text,
  true            -- true = local a la transacción
) as jwt_simulado;

set local role authenticated;

select
  auth.uid()                                                                       as uid,
  json_typeof(public.get_boot_data(auth.uid(), '2020-01-01', '2020-01-01'))         as boot,
  json_typeof(public.get_dashboard_data(auth.uid(), '2020-01-01', '2020-01-01'))    as dashboard,
  json_typeof(public.get_reflect_data(auth.uid(), '2020-01-01', '2020-12-31'))      as reflect,
  json_typeof(public.get_spending_overview(auth.uid(), '2020-01-01', '2020-12-31')) as overview,
  (select count(*) from public.get_yearly_totals(auth.uid(), 2019, 2026))           as yearly_filas,
  json_array_length(public.get_boot_data(auth.uid(), '2020-01-01', '2020-01-01') -> 'categories')     as categorias,
  json_array_length(public.get_boot_data(auth.uid(), '2020-01-01', '2020-01-01') -> 'monthly_totals') as meses_con_datos;

rollback;


-- ═══ BLOQUE D — ¿el guard bloquea a un tercero? ══════════════════════════════
-- Devuelve una fila con el veredicto. Atrapa la excepción adentro, así que
-- aprobar se ve como 'OK', no como un error del editor.
begin;

create function pg_temp.check_guard() returns text language plpgsql as $$
begin
  perform public.get_boot_data(
    '00000000-0000-0000-0000-000000000000'::uuid, '2020-01-01', '2020-01-01');
  return 'FALLO — el guard NO bloqueó: se pudieron leer datos de otro usuario';
exception
  when insufficient_privilege then
    return 'OK — bloqueado (42501 not authorized)';
  when others then
    return 'REVISAR — falló con otro error: ' || sqlstate || ' ' || sqlerrm;
end $$;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', coalesce(
      (select user_id from public.expenses group by user_id order by count(*) desc limit 1),
      (select id from auth.users order by created_at limit 1)
    ),
    'role', 'authenticated'
  )::text,
  true
);

set local role authenticated;

select pg_temp.check_guard() as veredicto_guard;

rollback;


-- ═══ BLOQUE E — ¿algo llama a las RPCs sin JWT de usuario? ═══════════════════
-- El guard rompe cualquier llamada con service_role o desde pg_cron, porque
-- ahí auth.uid() es null. `to_regclass` evita el error si pg_cron no está.
select
  case
    when to_regclass('cron.job') is null
      then 'OK — pg_cron no está instalado, no hay jobs que se puedan romper'
    else 'ATENCIÓN — pg_cron instalado: correr el bloque E2'
  end as pg_cron,
  (select count(*) from information_schema.triggers
    where trigger_schema = 'public'
      and action_statement ilike '%generate_recurring%')  as triggers_sospechosos;  -- espera 0


-- ═══ BLOQUE E2 — solo si E dijo ATENCIÓN ═════════════════════════════════════
-- select jobname, schedule, command
-- from cron.job
-- where command ilike '%generate_recurring%'
--    or command ilike '%get_boot_data%';
