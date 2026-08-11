-- ============================================================================
-- 003_redundant_indexes.sql
--
-- El volcado del esquema mostró cinco índices que no aportan nada: o son un
-- duplicado exacto de otro, o su columna es prefijo de un índice más ancho que
-- ya existe (Postgres usa el prefijo de un índice compuesto sin problema).
--
-- Cada índice de más se paga en cada INSERT/UPDATE/DELETE de la tabla y en
-- espacio. Ninguno de estos se pierde: la query que lo usaba queda servida por
-- el índice que se conserva.
--
-- Solo toca índices — no hay riesgo para los datos, y volver atrás es recrear
-- el que quieras. Se puede correr en cualquier momento.
-- ============================================================================

-- global_budget_periods: tres índices sobre (user_id, month).
--   - global_budget_periods_user_id_month_key  UNIQUE (user_id, month)  ← se queda
--   - idx_global_budget_periods_user_month     (user_id, month)          duplicado
--   - idx_global_budget_periods_user           (user_id, month)          duplicado
-- El índice de la constraint UNIQUE ya sirve para todas las lecturas.
drop index if exists public.idx_global_budget_periods_user_month;
drop index if exists public.idx_global_budget_periods_user;

-- user_settings: user_settings_user_id_key es UNIQUE (user_id) ← se queda.
drop index if exists public.idx_user_settings_user;

-- budget_categories: budget_categories_budget_id_category_id_key es
-- UNIQUE (budget_id, category_id); budget_id es su prefijo ← se queda.
drop index if exists public.idx_budget_categories_budget;

-- budget_category_periods: idx_bcp_budget_from es (budget_id, valid_from) y
-- budget_id es su prefijo ← se queda. Además idx_bcp_budget_active cubre el
-- filtro `valid_to is null` que usa BudgetsView.
drop index if exists public.idx_budget_category_periods_budget;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pendiente de decisión: expenses tiene tres índices que se solapan
-- ─────────────────────────────────────────────────────────────────────────────
--   idx_expenses_user_date      (user_id, date desc)
--   idx_expenses_user_date_cat  (user_id, date, category_id)
--   idx_expenses_user_cat_date  (user_id, category_id, date)
--
-- El primero es prefijo del segundo (Postgres escanea al revés sin problema
-- para el ORDER BY date DESC), así que idx_expenses_user_date es candidato a
-- borrarse. `expenses` es la tabla con más escrituras de la app, así que es
-- donde más se gana — pero antes de tocarlo conviene confirmar con datos reales
-- que el planner no lo está eligiendo:
--
--   select indexrelname, idx_scan, idx_tup_read
--   from pg_stat_user_indexes
--   where relname = 'expenses'
--   order by idx_scan desc;
--
-- Si idx_expenses_user_date tiene idx_scan cerca de 0 comparado con los otros,
-- se puede borrar:
--
--   -- drop index if exists public.idx_expenses_user_date;
--
-- (idx_expenses_user_cat_date sí se queda: sirve el `in (category_id...)` de
-- BudgetsView, donde category_id va antes que date.)
