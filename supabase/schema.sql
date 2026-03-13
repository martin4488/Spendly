-- ============================================
-- SPENDLY - Database Schema
-- Copiá y pegá todo esto en el SQL Editor de Supabase
-- ============================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- TABLA: categories (categorías de gastos)
-- ============================================
create table public.categories (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  icon text default '📦',
  color text default '#64748b',
  budget_amount decimal(12,2) default 0,
  budget_period text default 'monthly' check (budget_period in ('monthly', 'yearly')),
  parent_id uuid references public.categories(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- TABLA: expenses (gastos)
-- ============================================
create table public.expenses (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  category_id uuid references public.categories(id) on delete set null,
  amount decimal(12,2) not null,
  description text not null,
  notes text,
  date date not null default current_date,
  is_recurring boolean default false,
  recurring_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- TABLA: recurring_expenses (gastos recurrentes)
-- ============================================
create table public.recurring_expenses (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  category_id uuid references public.categories(id) on delete set null,
  amount decimal(12,2) not null,
  description text not null,
  notes text,
  frequency text not null default 'monthly' check (frequency in ('weekly', 'monthly', 'yearly')),
  day_of_month integer default 1,
  is_active boolean default true,
  last_generated date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- ÍNDICES para performance
-- ============================================
create index idx_expenses_user_date on public.expenses(user_id, date desc);
create index idx_expenses_category on public.expenses(category_id);
create index idx_categories_user on public.categories(user_id);
create index idx_categories_parent on public.categories(parent_id);
create index idx_recurring_user on public.recurring_expenses(user_id);

-- ============================================
-- ROW LEVEL SECURITY (cada usuario ve solo sus datos)
-- ============================================

-- Categories
alter table public.categories enable row level security;

create policy "Users can view own categories"
  on public.categories for select
  using (auth.uid() = user_id);

create policy "Users can insert own categories"
  on public.categories for insert
  with check (auth.uid() = user_id);

create policy "Users can update own categories"
  on public.categories for update
  using (auth.uid() = user_id);

create policy "Users can delete own categories"
  on public.categories for delete
  using (auth.uid() = user_id);

-- Expenses
alter table public.expenses enable row level security;

create policy "Users can view own expenses"
  on public.expenses for select
  using (auth.uid() = user_id);

create policy "Users can insert own expenses"
  on public.expenses for insert
  with check (auth.uid() = user_id);

create policy "Users can update own expenses"
  on public.expenses for update
  using (auth.uid() = user_id);

create policy "Users can delete own expenses"
  on public.expenses for delete
  using (auth.uid() = user_id);

-- Recurring Expenses
alter table public.recurring_expenses enable row level security;

create policy "Users can view own recurring"
  on public.recurring_expenses for select
  using (auth.uid() = user_id);

create policy "Users can insert own recurring"
  on public.recurring_expenses for insert
  with check (auth.uid() = user_id);

create policy "Users can update own recurring"
  on public.recurring_expenses for update
  using (auth.uid() = user_id);

create policy "Users can delete own recurring"
  on public.recurring_expenses for delete
  using (auth.uid() = user_id);

-- ============================================
-- FUNCIÓN: generar gastos recurrentes automáticamente
-- (se ejecuta cuando el usuario abre la app)
-- ============================================
create or replace function public.generate_recurring_expenses(p_user_id uuid)
returns void as $$
declare
  rec record;
  next_date date;
  today date := current_date;
begin
  for rec in
    select * from public.recurring_expenses
    where user_id = p_user_id and is_active = true
  loop
    -- Calculate next date based on frequency
    if rec.last_generated is null then
      next_date := today;
    elsif rec.frequency = 'monthly' then
      next_date := rec.last_generated + interval '1 month';
    elsif rec.frequency = 'weekly' then
      next_date := rec.last_generated + interval '1 week';
    elsif rec.frequency = 'yearly' then
      next_date := rec.last_generated + interval '1 year';
    end if;

    -- Generate expenses up to today
    while next_date <= today loop
      -- Check if expense already exists for this date
      if not exists (
        select 1 from public.expenses
        where recurring_id = rec.id and date = next_date
      ) then
        insert into public.expenses (user_id, category_id, amount, description, notes, date, is_recurring, recurring_id)
        values (rec.user_id, rec.category_id, rec.amount, rec.description, rec.notes, next_date, true, rec.id);
      end if;

      -- Update last_generated
      update public.recurring_expenses set last_generated = next_date where id = rec.id;

      -- Move to next period
      if rec.frequency = 'monthly' then
        next_date := next_date + interval '1 month';
      elsif rec.frequency = 'weekly' then
        next_date := next_date + interval '1 week';
      elsif rec.frequency = 'yearly' then
        next_date := next_date + interval '1 year';
      end if;
    end loop;
  end loop;
end;
$$ language plpgsql security definer;
