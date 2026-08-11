-- ============================================
-- SPENDLY - Database Schema
--
-- Volcado del proyecto real (ver README.md para regenerarlo). Completo: tablas,
-- constraints, índices, RLS y las funciones RPC.
--
-- Orden: las tablas van primero en orden de dependencia (FK), después los
-- índices, después RLS, después las funciones.
--
-- Para aplicar cambios sobre una base que ya existe, usá migrations/ — no este
-- archivo.
-- ============================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ============================================
-- TABLAS
-- ============================================

-- ── user_settings ────────────────────────────────────────────────────────────
create table public.user_settings (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  default_currency text default 'EUR'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint user_settings_pkey primary key (id),
  constraint user_settings_user_id_key unique (user_id),
  constraint user_settings_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint user_settings_default_currency_check check (default_currency = any (array['EUR'::text, 'USD'::text, 'ARS'::text]))
);

-- ── categories (jerárquicas vía parent_id) ───────────────────────────────────
create table public.categories (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  name text not null,
  icon text default 'package'::text,
  color text default '#64748b'::text,
  budget_amount numeric(12,2) default 0,
  budget_period text default 'monthly'::text,
  parent_id uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  "position" integer default 0,
  deleted boolean default false,
  hidden boolean default false,
  constraint categories_pkey primary key (id),
  constraint categories_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint categories_parent_id_fkey foreign key (parent_id) references public.categories(id) on delete set null,
  constraint categories_budget_period_check check (budget_period = any (array['monthly'::text, 'yearly'::text]))
);

-- ── expenses ─────────────────────────────────────────────────────────────────
create table public.expenses (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  category_id uuid,
  amount numeric(12,2) not null,
  description text default ''::text,
  notes text,
  date date default CURRENT_DATE not null,
  is_recurring boolean default false,
  recurring_id uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  original_currency text,
  original_amount numeric(12,2) default null::numeric,
  constraint expenses_pkey primary key (id),
  constraint expenses_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint expenses_category_id_fkey foreign key (category_id) references public.categories(id) on delete set null
);

-- ── recurring_expenses ───────────────────────────────────────────────────────
create table public.recurring_expenses (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  category_id uuid,
  amount numeric(12,2) not null,
  description text not null,
  notes text,
  frequency text default 'monthly'::text not null,
  day_of_month integer default 1,
  is_active boolean default true,
  last_generated date,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  end_date date,
  start_date date default CURRENT_DATE not null,
  constraint recurring_expenses_pkey primary key (id),
  constraint recurring_expenses_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint recurring_expenses_category_id_fkey foreign key (category_id) references public.categories(id) on delete set null,
  constraint recurring_expenses_frequency_check check (frequency = any (array['weekly'::text, 'monthly'::text, 'yearly'::text]))
);

-- ── budgets ──────────────────────────────────────────────────────────────────
create table public.budgets (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  name text not null,
  amount numeric(12,2) default 0 not null,
  currency text default 'USD'::text,
  recurrence text default 'monthly'::text,
  start_date date default (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint budgets_pkey primary key (id),
  constraint budgets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint budgets_recurrence_check check (recurrence = any (array['monthly'::text, 'yearly'::text]))
);

-- ── budget_periods (un período por mes/año de cada budget) ───────────────────
create table public.budget_periods (
  id uuid default gen_random_uuid() not null,
  budget_id uuid,
  period_start date not null,
  period_end date not null,
  created_at timestamp with time zone default now(),
  amount numeric,
  constraint budget_periods_pkey primary key (id),
  constraint budget_periods_budget_id_fkey foreign key (budget_id) references public.budgets(id) on delete cascade
);

-- ── budget_category_periods ──────────────────────────────────────────────────
-- Vínculo budget↔categoría con historial: la fila activa es la que tiene
-- valid_to IS NULL. Es la tabla que usa la app (ver BudgetsView).
create table public.budget_category_periods (
  id uuid default gen_random_uuid() not null,
  budget_id uuid not null,
  category_id uuid not null,
  valid_from date not null,
  valid_to date,
  created_at timestamp with time zone default now() not null,
  constraint budget_category_periods_pkey primary key (id),
  constraint budget_category_periods_budget_id_fkey foreign key (budget_id) references public.budgets(id) on delete cascade,
  constraint budget_category_periods_category_id_fkey foreign key (category_id) references public.categories(id) on delete cascade
);

-- ── budget_categories ────────────────────────────────────────────────────────
-- ⚠ LEGACY. Ninguna parte del código la consulta — quedó reemplazada por
--   budget_category_periods, que agrega historial. Se mantiene acá porque sigue
--   existiendo en la base. Ver migrations/003_drop_legacy.sql.
create table public.budget_categories (
  id uuid default uuid_generate_v4() not null,
  budget_id uuid not null,
  category_id uuid not null,
  constraint budget_categories_pkey primary key (id),
  constraint budget_categories_budget_id_category_id_key unique (budget_id, category_id),
  constraint budget_categories_budget_id_fkey foreign key (budget_id) references public.budgets(id) on delete cascade,
  constraint budget_categories_category_id_fkey foreign key (category_id) references public.categories(id) on delete cascade
);

-- ── global_budget_periods (presupuesto mensual global, no por categoría) ─────
create table public.global_budget_periods (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  month text not null,            -- 'YYYY-MM'
  amount numeric(12,2) not null,
  created_at timestamp with time zone default now(),
  constraint global_budget_periods_pkey primary key (id),
  constraint global_budget_periods_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint global_budget_periods_user_id_month_key unique (user_id, month)
);

-- ============================================
-- ÍNDICES
-- ============================================
-- Los que respaldan PRIMARY KEY / UNIQUE los crea Postgres solo, no van acá.

create index idx_categories_user   on public.categories(user_id);
create index idx_categories_parent on public.categories(parent_id);

create index idx_expenses_user_date     on public.expenses(user_id, date desc);
create index idx_expenses_category      on public.expenses(category_id);
create index idx_expenses_user_date_cat on public.expenses(user_id, date, category_id);
-- Requerido por generate_recurring_expenses(): sondea (recurring_id, date) una
-- vez por período evaluado. Ver migrations/001_performance.sql.
create index idx_expenses_recurring     on public.expenses(recurring_id, date);

create index idx_recurring_user on public.recurring_expenses(user_id);

create index idx_budgets_user        on public.budgets(user_id);
create index idx_budget_periods_budget on public.budget_periods(budget_id, period_start);

create index idx_bcp_budget_from   on public.budget_category_periods(budget_id, valid_from);
-- BudgetsView filtra siempre por `valid_to is null`; el índice parcial es chico.
create index idx_bcp_budget_active on public.budget_category_periods(budget_id) where valid_to is null;

create index idx_budget_categories_category on public.budget_categories(category_id);

create index idx_global_budget_periods_user_month on public.global_budget_periods(user_id, month);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table public.user_settings           enable row level security;
alter table public.categories              enable row level security;
alter table public.expenses                enable row level security;
alter table public.recurring_expenses      enable row level security;
alter table public.budgets                 enable row level security;
alter table public.budget_periods          enable row level security;
alter table public.budget_category_periods enable row level security;
alter table public.budget_categories       enable row level security;
alter table public.global_budget_periods   enable row level security;

-- ── user_settings ──
create policy "Users can view own settings"   on public.user_settings for select using (auth.uid() = user_id);
create policy "Users can insert own settings" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "Users can update own settings" on public.user_settings for update using (auth.uid() = user_id);

-- ── categories ──
create policy "Users can view own categories"   on public.categories for select using (auth.uid() = user_id);
create policy "Users can insert own categories" on public.categories for insert with check (auth.uid() = user_id);
create policy "Users can update own categories" on public.categories for update using (auth.uid() = user_id);
create policy "Users can delete own categories" on public.categories for delete using (auth.uid() = user_id);

-- ── expenses ──
create policy "Users can view own expenses"   on public.expenses for select using (auth.uid() = user_id);
create policy "Users can insert own expenses" on public.expenses for insert with check (auth.uid() = user_id);
create policy "Users can update own expenses" on public.expenses for update using (auth.uid() = user_id);
create policy "Users can delete own expenses" on public.expenses for delete using (auth.uid() = user_id);

-- ── recurring_expenses ──
create policy "Users can view own recurring"   on public.recurring_expenses for select using (auth.uid() = user_id);
create policy "Users can insert own recurring" on public.recurring_expenses for insert with check (auth.uid() = user_id);
create policy "Users can update own recurring" on public.recurring_expenses for update using (auth.uid() = user_id);
create policy "Users can delete own recurring" on public.recurring_expenses for delete using (auth.uid() = user_id);

-- ── budgets ──
create policy "Users can view own budgets"   on public.budgets for select using (auth.uid() = user_id);
create policy "Users can insert own budgets" on public.budgets for insert with check (auth.uid() = user_id);
create policy "Users can update own budgets" on public.budgets for update using (auth.uid() = user_id);
create policy "Users can delete own budgets" on public.budgets for delete using (auth.uid() = user_id);

-- ── budget_periods (heredan del budget dueño) ──
create policy "Users manage own budget_periods" on public.budget_periods for all
  using (budget_id in (select budgets.id from public.budgets where budgets.user_id = auth.uid()))
  with check (budget_id in (select budgets.id from public.budgets where budgets.user_id = auth.uid()));

-- ── budget_category_periods ──
-- ⚠ Sin WITH CHECK: para FOR ALL, Postgres usa USING como fallback en INSERT,
--   así que funciona, pero conviene explicitarlo como en budget_periods.
create policy "users own budget_category_periods" on public.budget_category_periods for all
  using (budget_id in (select budgets.id from public.budgets where budgets.user_id = auth.uid()));

-- ── budget_categories (legacy) ──
create policy "Users can view own budget_categories" on public.budget_categories for select
  using (exists (select 1 from public.budgets b where b.id = budget_categories.budget_id and b.user_id = auth.uid()));
create policy "Users can insert own budget_categories" on public.budget_categories for insert
  with check (exists (select 1 from public.budgets b where b.id = budget_categories.budget_id and b.user_id = auth.uid()));
create policy "Users can delete own budget_categories" on public.budget_categories for delete
  using (exists (select 1 from public.budgets b where b.id = budget_categories.budget_id and b.user_id = auth.uid()));

-- ── global_budget_periods ──
create policy "Users can manage their own global budget periods" on public.global_budget_periods for all
  using (auth.uid() = user_id);

-- ============================================
-- FUNCIONES RPC
--
-- ⚠ SEGURIDAD: todas son SECURITY DEFINER y filtran por el parámetro p_user_id
--   en vez de por auth.uid(). SECURITY DEFINER saltea RLS, así que cualquiera
--   con la anon key (que es pública, va en el bundle) puede pedir los datos de
--   otro usuario pasando su UUID. Ver migrations/002_rpc_auth.sql.
-- ============================================

-- ── get_boot_data: todo lo que necesita el arranque en una sola llamada ──────
create or replace function public.get_boot_data(p_user_id uuid, p_recent_start text, p_chart_start text)
 returns json
 language plpgsql
 security definer
as $function$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    -- 1. User settings (currency)
    'currency', (
      SELECT COALESCE(default_currency, 'EUR')
      FROM user_settings
      WHERE user_id = p_user_id
      LIMIT 1
    ),
    -- 2. Categories (active, ordered)
    'categories', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', id,
          'user_id', user_id,
          'name', name,
          'icon', icon,
          'color', color,
          'parent_id', parent_id,
          'hidden', hidden,
          'position', position,
          'created_at', created_at,
          'updated_at', updated_at
        ) ORDER BY position, created_at
      ), '[]'::json)
      FROM categories
      WHERE user_id = p_user_id AND deleted IS DISTINCT FROM TRUE
    ),
    -- 3. Recent expenses (last 31 days)
    -- ⚠ El LIMIT 500 va sin ORDER BY dentro de la subquery: con más de 500
    --   gastos en la ventana, Postgres devuelve 500 cualesquiera y recién
    --   después ordena. Ver migrations/002_rpc_auth.sql.
    'recent_expenses', (
      SELECT COALESCE(json_agg(row_to_json(e) ORDER BY e.date DESC, e.created_at DESC), '[]'::json)
      FROM (
        SELECT *
        FROM expenses
        WHERE user_id = p_user_id AND date >= p_recent_start::date
        LIMIT 500
      ) e
    ),
    -- 4. Monthly totals for chart (last 6 months)
    'monthly_totals', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.month), '[]'::json)
      FROM (
        SELECT
          TO_CHAR(date, 'YYYY-MM') AS month,
          SUM(amount) AS total
        FROM expenses
        WHERE user_id = p_user_id AND date >= p_chart_start::date
        GROUP BY TO_CHAR(date, 'YYYY-MM')
      ) t
    )
  ) INTO result;

  RETURN result;
END;
$function$;

-- ── get_dashboard_data: igual que get_boot_data pero sin settings/categorías ─
create or replace function public.get_dashboard_data(p_user_id uuid, p_recent_start text, p_chart_start text)
 returns json
 language plpgsql
 security definer
as $function$
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
$function$;

-- ── get_reflect_data ─────────────────────────────────────────────────────────
-- Los parámetros llegan como text (la app manda 'yyyy-MM-dd') y se castean a
-- date en el DECLARE. Sin ese cast la función explota: no existe el operador
-- `date >= text`. Ver migrations/004_fix_date_casts.sql.
create or replace function public.get_reflect_data(p_user_id uuid, p_year_start text, p_year_end text)
 returns json
 language plpgsql
 security definer
 set search_path = public
as $function$
DECLARE
  result JSON;
  v_start date := p_year_start::date;
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

-- ── get_spending_overview ────────────────────────────────────────────────────
-- Mismo cast que get_reflect_data — sin él la función falla y SpendingOverview
-- cae al fallback lento del cliente sin mostrar ningún error.
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

-- ── get_yearly_totals ────────────────────────────────────────────────────────
create or replace function public.get_yearly_totals(p_user_id uuid, p_start_year integer, p_end_year integer)
 returns table(year integer, total numeric)
 language sql
 stable
as $function$
  SELECT
    EXTRACT(YEAR FROM date)::int AS year,
    SUM(amount) AS total
  FROM expenses
  WHERE user_id = p_user_id
    AND date >= make_date(p_start_year, 1, 1)
    AND date <= make_date(p_end_year, 12, 31)
  GROUP BY EXTRACT(YEAR FROM date)::int
  ORDER BY year;
$function$;

-- ── generate_recurring_expenses ──────────────────────────────────────────────
-- Definición completa (con el UPDATE fuera del while) en
-- migrations/001_performance.sql — es la fuente de verdad de esta función.
-- Correr esa migración después de crear el esquema.

-- ============================================
-- REALTIME
-- ============================================
-- Broadcast de cambios en `expenses` para que otros dispositivos se actualicen
-- solos (ver src/lib/useSyncOnForeground.ts). RLS sigue aplicando: cada cliente
-- recibe únicamente las filas que puede leer. Idempotente.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'expenses'
  ) then
    alter publication supabase_realtime add table public.expenses;
  end if;
end $$;
