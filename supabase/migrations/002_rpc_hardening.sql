-- ============================================================================
-- 002_rpc_hardening.sql
--
-- ⚠ REVISAR ANTES DE CORRER. Cambia comportamiento, no solo performance.
--
-- Tres cosas que salieron al volcar el esquema:
--
--   1. SEGURIDAD — Las RPCs son SECURITY DEFINER y filtran por el parámetro
--      `p_user_id` en vez de por `auth.uid()`. SECURITY DEFINER saltea RLS, así
--      que hoy cualquiera con la anon key (pública, va en el bundle del cliente)
--      puede leer los datos de otro usuario mandando su UUID:
--
--        curl -X POST "$URL/rest/v1/rpc/get_boot_data" \
--          -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
--          -d '{"p_user_id":"<uuid-de-otro>","p_recent_start":"2020-01-01","p_chart_start":"2020-01-01"}'
--
--      La app siempre manda el UUID de la sesión, así que agregar el guard no
--      cambia nada para ella. Si tenés algún job con service_role que llame a
--      estas funciones, ese sí se va a romper (auth.uid() es null ahí) — en ese
--      caso avisá y lo hacemos condicional.
--
--   2. get_reflect_data está DUPLICADA: (uuid, text, text) y (uuid, date, date),
--      con los mismos nombres de parámetro. PostgREST puede no saber cuál elegir
--      y devolver PGRST203; ReflectView cae en silencio al fallback lento.
--      Dejamos solo la de text, que es la que llama la app.
--
--   3. get_boot_data hace `LIMIT 500` SIN `ORDER BY` dentro de la subquery: con
--      más de 500 gastos en la ventana de 31 días, Postgres devuelve 500
--      cualesquiera y recién después ordena. Se ordena antes de limitar.
--
-- Después de correr esto: `npm test` con .env.local configurado.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Sacar la sobrecarga duplicada de get_reflect_data
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.get_reflect_data(uuid, date, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Guard de identidad + fix del LIMIT en get_boot_data
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_boot_data(p_user_id uuid, p_recent_start text, p_chart_start text)
 returns json
 language plpgsql
 security definer
 set search_path = public
as $function$
DECLARE
  result JSON;
BEGIN
  IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'currency', (
      SELECT COALESCE(default_currency, 'EUR')
      FROM user_settings
      WHERE user_id = p_user_id
      LIMIT 1
    ),
    'categories', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', id, 'user_id', user_id, 'name', name, 'icon', icon,
          'color', color, 'parent_id', parent_id, 'hidden', hidden,
          'position', position, 'created_at', created_at, 'updated_at', updated_at
        ) ORDER BY position, created_at
      ), '[]'::json)
      FROM categories
      WHERE user_id = p_user_id AND deleted IS DISTINCT FROM TRUE
    ),
    -- ORDER BY movido adentro del LIMIT: antes recortaba a 500 filas
    -- arbitrarias y ordenaba después.
    'recent_expenses', (
      SELECT COALESCE(json_agg(row_to_json(e) ORDER BY e.date DESC, e.created_at DESC), '[]'::json)
      FROM (
        SELECT *
        FROM expenses
        WHERE user_id = p_user_id AND date >= p_recent_start::date
        ORDER BY date DESC, created_at DESC
        LIMIT 500
      ) e
    ),
    'monthly_totals', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.month), '[]'::json)
      FROM (
        SELECT TO_CHAR(date, 'YYYY-MM') AS month, SUM(amount) AS total
        FROM expenses
        WHERE user_id = p_user_id AND date >= p_chart_start::date
        GROUP BY TO_CHAR(date, 'YYYY-MM')
      ) t
    )
  ) INTO result;

  RETURN result;
END;
$function$;

create or replace function public.get_dashboard_data(p_user_id uuid, p_recent_start text, p_chart_start text)
 returns json
 language plpgsql
 security definer
 set search_path = public
as $function$
DECLARE
  result json;
BEGIN
  IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

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
$function$;

create or replace function public.get_reflect_data(p_user_id uuid, p_year_start text, p_year_end text)
 returns json
 language plpgsql
 security definer
 set search_path = public
as $function$
DECLARE
  result JSON;
BEGIN
  IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'monthly_totals', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.month), '[]'::json)
      FROM (
        SELECT TO_CHAR(date::date, 'YYYY-MM') AS month, SUM(amount) AS total
        FROM expenses
        WHERE user_id = p_user_id AND date >= p_year_start AND date <= p_year_end
        GROUP BY TO_CHAR(date::date, 'YYYY-MM')
      ) t
    ),
    'category_totals', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT category_id, TO_CHAR(date::date, 'YYYY-MM') AS month, SUM(amount) AS total
        FROM expenses
        WHERE user_id = p_user_id AND date >= p_year_start AND date <= p_year_end
          AND category_id IS NOT NULL
        GROUP BY category_id, TO_CHAR(date::date, 'YYYY-MM')
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
        WHERE user_id = p_user_id AND date >= p_start_date AND date <= p_end_date
        GROUP BY category_id
      ) t
    ),
    'total', (
      SELECT COALESCE(SUM(amount), 0)
      FROM expenses
      WHERE user_id = p_user_id AND date >= p_start_date AND date <= p_end_date
    )
  ) INTO result;

  RETURN result;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. generate_recurring_expenses: mismo guard
-- ─────────────────────────────────────────────────────────────────────────────
-- Sin esto, cualquiera puede inyectar gastos en la cuenta de otro usuario.
-- Cuerpo idéntico al de 001_performance.sql; lo único agregado es el guard.
create or replace function public.generate_recurring_expenses(p_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  rec record;
  next_date date;
  today date := current_date;
  target_day integer;
  calc_year integer;
  calc_month integer;
  effective_start date;
  last_date date;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  for rec in
    select * from public.recurring_expenses
    where user_id = p_user_id and is_active = true
  loop
    if rec.end_date is not null and rec.end_date < today then
      continue;
    end if;

    target_day := rec.day_of_month;
    effective_start := coalesce(rec.start_date, rec.created_at::date, today);

    if rec.last_generated is null then
      if rec.frequency = 'monthly' then
        calc_year  := extract(year  from effective_start);
        calc_month := extract(month from effective_start);
        next_date  := make_date(calc_year, calc_month,
          least(target_day,
            extract(day from (make_date(calc_year, calc_month, 1) + interval '1 month' - interval '1 day'))::integer
          )
        );
        if next_date < effective_start then
          calc_month := calc_month + 1;
          if calc_month > 12 then calc_month := 1; calc_year := calc_year + 1; end if;
          next_date := make_date(calc_year, calc_month,
            least(target_day,
              extract(day from (make_date(calc_year, calc_month, 1) + interval '1 month' - interval '1 day'))::integer
            )
          );
        end if;

      elsif rec.frequency = 'weekly' then
        next_date := effective_start;

      elsif rec.frequency = 'yearly' then
        calc_year := extract(year from effective_start);
        next_date := make_date(calc_year,
          extract(month from effective_start)::integer,
          least(target_day,
            extract(day from (make_date(calc_year, extract(month from effective_start)::integer, 1) + interval '1 month' - interval '1 day'))::integer
          )
        );
        if next_date < effective_start then
          next_date := next_date + interval '1 year';
        end if;
      end if;

    else
      if rec.frequency = 'monthly' then
        calc_year  := extract(year  from rec.last_generated);
        calc_month := extract(month from rec.last_generated) + 1;
        if calc_month > 12 then calc_month := 1; calc_year := calc_year + 1; end if;
        next_date := make_date(calc_year, calc_month,
          least(target_day,
            extract(day from (make_date(calc_year, calc_month, 1) + interval '1 month' - interval '1 day'))::integer
          )
        );
      elsif rec.frequency = 'weekly' then
        next_date := rec.last_generated + interval '1 week';
      elsif rec.frequency = 'yearly' then
        next_date := rec.last_generated + interval '1 year';
      end if;
    end if;

    last_date := null;

    while next_date <= today loop
      if rec.end_date is not null and next_date > rec.end_date then
        exit;
      end if;

      if next_date < effective_start then
        if rec.frequency = 'monthly' then
          calc_year  := extract(year  from next_date);
          calc_month := extract(month from next_date) + 1;
          if calc_month > 12 then calc_month := 1; calc_year := calc_year + 1; end if;
          next_date := make_date(calc_year, calc_month,
            least(target_day,
              extract(day from (make_date(calc_year, calc_month, 1) + interval '1 month' - interval '1 day'))::integer
            )
          );
        elsif rec.frequency = 'weekly' then
          next_date := next_date + interval '1 week';
        elsif rec.frequency = 'yearly' then
          next_date := next_date + interval '1 year';
        end if;
        continue;
      end if;

      if not exists (
        select 1 from public.expenses
        where recurring_id = rec.id and date = next_date
      ) then
        insert into public.expenses (user_id, category_id, amount, description, notes, date, is_recurring, recurring_id)
        values (rec.user_id, rec.category_id, rec.amount, rec.description, rec.notes, next_date, true, rec.id);
      end if;

      last_date := next_date;

      if rec.frequency = 'monthly' then
        calc_year  := extract(year  from next_date);
        calc_month := extract(month from next_date) + 1;
        if calc_month > 12 then calc_month := 1; calc_year := calc_year + 1; end if;
        next_date := make_date(calc_year, calc_month,
          least(target_day,
            extract(day from (make_date(calc_year, calc_month, 1) + interval '1 month' - interval '1 day'))::integer
          )
        );
      elsif rec.frequency = 'weekly' then
        next_date := next_date + interval '1 week';
      elsif rec.frequency = 'yearly' then
        next_date := next_date + interval '1 year';
      end if;
    end loop;

    if last_date is not null then
      update public.recurring_expenses set last_generated = last_date where id = rec.id;
    end if;
  end loop;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Verificación del guard
-- ─────────────────────────────────────────────────────────────────────────────
-- Con la app logueada, todo tiene que seguir andando igual. Y esto tiene que
-- fallar con 42501 en vez de devolver datos (poné un UUID que no sea el tuyo):
--
--   select public.get_boot_data(
--     '00000000-0000-0000-0000-000000000000',
--     '2020-01-01', '2020-01-01');
--
-- Ojo: desde el SQL Editor auth.uid() es null, así que va a fallar siempre —
-- eso es lo esperado. La prueba real es `npm test` con .env.local.
