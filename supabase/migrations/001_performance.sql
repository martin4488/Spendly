-- ============================================================================
-- 001_performance.sql
--
-- Pegá esto en el SQL Editor de Supabase. Es idempotente: se puede correr
-- varias veces sin efecto extra.
--
-- ⚠ La versión anterior de este archivo reescribía generate_recurring_expenses()
--   partiendo de la definición desactualizada de schema.sql, y habría borrado el
--   manejo de end_date / start_date / day_of_month que tiene la función real.
--   Lo de abajo es la función que está en producción, con un único cambio:
--   el UPDATE sale del while.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Índice para generate_recurring_expenses()
-- ─────────────────────────────────────────────────────────────────────────────
-- La función pregunta `where recurring_id = ? and date = ?` una vez por cada
-- período que evalúa. Sin este índice cada pregunta es un scan secuencial de
-- toda la tabla `expenses`.
create index if not exists idx_expenses_recurring
  on public.expenses(recurring_id, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. generate_recurring_expenses(): un UPDATE por recurrente, no uno por período
-- ─────────────────────────────────────────────────────────────────────────────
-- Idéntica a la de producción salvo por `last_date`: antes escribía
-- `last_generated` en cada vuelta del while, así que un recurrente semanal sin
-- generar por tres meses hacía ~13 UPDATEs sobre la misma fila. Ahora hace uno.
-- El valor final de last_generated es exactamente el mismo.
create or replace function public.generate_recurring_expenses(p_user_id uuid)
 returns void
 language plpgsql
 security definer
as $function$
declare
  rec record;
  next_date date;
  today date := current_date;
  target_day integer;
  calc_year integer;
  calc_month integer;
  effective_start date;
  last_date date;   -- ← nuevo: última fecha generada, se escribe una sola vez
begin
  for rec in
    select * from public.recurring_expenses
    where user_id = p_user_id and is_active = true
  loop
    -- Skip if end_date has passed
    if rec.end_date is not null and rec.end_date < today then
      continue;
    end if;

    target_day := rec.day_of_month;
    -- Use start_date as the floor for generation (never generate before it)
    effective_start := coalesce(rec.start_date, rec.created_at::date, today);

    if rec.last_generated is null then
      -- First time: find the first occurrence on or after start_date

      if rec.frequency = 'monthly' then
        calc_year  := extract(year  from effective_start);
        calc_month := extract(month from effective_start);
        next_date  := make_date(calc_year, calc_month,
          least(target_day,
            extract(day from (make_date(calc_year, calc_month, 1) + interval '1 month' - interval '1 day'))::integer
          )
        );
        -- If that day is before start_date (e.g. start=15, day=5 → move to next month)
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
      -- Already generated before: next period after last_generated
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

    -- Generate all occurrences up to today
    while next_date <= today loop
      -- Respect end_date
      if rec.end_date is not null and next_date > rec.end_date then
        exit;
      end if;
      -- Never generate before start_date
      if next_date < effective_start then
        -- Advance to next period and continue
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

      -- Insert only if not already there (servido por idx_expenses_recurring)
      if not exists (
        select 1 from public.expenses
        where recurring_id = rec.id and date = next_date
      ) then
        insert into public.expenses (user_id, category_id, amount, description, notes, date, is_recurring, recurring_id)
        values (rec.user_id, rec.category_id, rec.amount, rec.description, rec.notes, next_date, true, rec.id);
      end if;

      -- Antes acá iba:
      --   update public.recurring_expenses set last_generated = next_date ...
      last_date := next_date;

      -- Advance to next period
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

    -- Un solo write por recurrente.
    if last_date is not null then
      update public.recurring_expenses set last_generated = last_date where id = rec.id;
    end if;
  end loop;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Verificación (opcional)
-- ─────────────────────────────────────────────────────────────────────────────
--   explain analyze
--   select 1 from public.expenses
--   where recurring_id = '00000000-0000-0000-0000-000000000000' and date = current_date;
--
-- Debería decir "Index Scan using idx_expenses_recurring", no "Seq Scan".
