# Esquema de Spendly

`schema.sql` está **completo** — volcado del proyecto real: las 9 tablas, sus
constraints, índices, políticas RLS y las 6 funciones RPC.

Ojo con una cosa que sigue vigente: **cada vista tiene un fallback silencioso**
que rearma el resultado con queries del lado del cliente si su RPC falla. Si una
RPC se rompe o se borra, la app sigue andando pero mucho más lenta y sin ningún
error visible. Por eso `tests/supabase-live.test.mjs` verifica que existan y
respondan todas.

## Migraciones

Correr en orden, desde el SQL Editor. Todas idempotentes.

### Pendiente

| Archivo | Qué hace | Riesgo |
|---|---|---|
| `006_budgets_rpc.sql` | **`get_budgets_data`**: BudgetsView pasa de 6 consultas en 3 tandas encadenadas a una sola llamada, con el gasto por período ya sumado en Postgres. Más el índice único de `budget_periods`. | Bajo — función nueva, con respaldo en el cliente |

> **Es la única `get_*` que escribe.** Materializa los períodos de presupuesto
> que falten hasta hoy, igual que venía haciendo el cliente. Tiene que pasar
> adentro de la función: si no, el primer día de un mes nuevo el período actual
> todavía no existe y el presupuesto aparece vacío. Es idempotente, y
> `tests/supabase-live.test.mjs` la llama dos veces para comprobarlo.
>
> Si el SQL Editor avisa `budget_periods tiene períodos duplicados`, el índice
> único no se creó. No es grave — la función igual filtra por `not exists`, que
> es lo que hacía el cliente. Para limpiarlos, BLOQUE F de
> [`verify.sql`](verify.sql).

### Aplicadas

`npm test` las verifica en cada corrida vía `spendly_health()` — si alguna se
revierte, el test lo dice.

| Archivo | Qué hizo |
|---|---|
| `001_performance.sql` | Índice `idx_expenses_recurring` + un solo UPDATE por recurrente en `generate_recurring_expenses()` |
| `002_rpc_hardening.sql` | **Cerró un agujero de autorización** en las RPCs, sacó la sobrecarga duplicada de `get_reflect_data`, arregló el `LIMIT` sin `ORDER BY` de `get_boot_data` |
| `004_fix_date_casts.sql` | `get_reflect_data` y `get_spending_overview` comparaban `date >= text`, que no existe como operador. Castea a `date`. Va **antes** que 003. |
| `003_redundant_indexes.sql` | Borró 5 índices duplicados |
| `005_health_check.sql` | Expone `spendly_health()`, que es lo que hace que esta tabla no se desactualice sola |

> **Por qué 004 iba antes que 003.** `002` dejó `get_reflect_data` en su versión
> rota (la sobrecarga que andaba era la que borró por "duplicada"), y de paso
> destapó que `get_spending_overview` venía fallando desde siempre —
> SpendingOverview corría el fallback lento del cliente sin avisar. `004` arregló
> las dos.

Después de aplicar cualquiera de ellas, correr [`verify.sql`](verify.sql): chequea
que quedó lo que esperábamos y — lo importante — prueba las RPCs con un JWT
simulado. Sin eso no te enterás si el guard de `002` las rompió, porque cada
vista cae al fallback lento en silencio.

### El agujero de 002, en corto

Las RPCs son `SECURITY DEFINER` (saltean RLS) y filtran por el parámetro
`p_user_id` en lugar de `auth.uid()`. Como la anon key es pública, hoy cualquiera
puede leer los datos de otro usuario si conoce su UUID:

```bash
curl -X POST "$URL/rest/v1/rpc/get_boot_data" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_user_id":"<uuid-ajeno>","p_recent_start":"2020-01-01","p_chart_start":"2020-01-01"}'
```

`002` agrega `if auth.uid() is null or p_user_id <> auth.uid() then raise`. La
app siempre manda el UUID de su propia sesión, así que para ella no cambia nada.

## Volver a volcar el esquema

Pegá esto en el **SQL Editor de Supabase** y ejecutá. Devuelve **una sola celda**
con el esquema entero: tablas, constraints, índices, políticas RLS y funciones.
Copiá esa celda y pegala en `schema.sql`.

Es de solo lectura — no modifica nada.

```sql
select string_agg(ddl, E'\n\n' order by section, obj) as spendly_schema
from (

  -- ── 1. Tablas ──────────────────────────────────────────────────────────────
  select 1 as section, c.relname::text as obj,
    format(E'-- table: public.%s\ncreate table public.%I (\n%s\n);',
      c.relname, c.relname,
      (
        select string_agg(
          format('  %I %s%s%s',
            a.attname,
            format_type(a.atttypid, a.atttypmod),
            coalesce(' default ' || pg_get_expr(ad.adbin, ad.adrelid), ''),
            case when a.attnotnull then ' not null' else '' end),
          E',\n' order by a.attnum)
        from pg_attribute a
        left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      )
    ) as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'

  union all

  -- ── 2. Constraints (PK, FK, unique, check) ────────────────────────────────
  select 2, (conrelid::regclass::text || '.' || conname)::text,
    format('alter table %s add constraint %I %s;',
      conrelid::regclass::text, conname, pg_get_constraintdef(oid))
  from pg_constraint
  where connamespace = 'public'::regnamespace
    and contype in ('p', 'f', 'u', 'c')

  union all

  -- ── 3. Índices ─────────────────────────────────────────────────────────────
  select 3, indexname::text, indexdef || ';'
  from pg_indexes
  where schemaname = 'public'

  union all

  -- ── 4. Políticas RLS ───────────────────────────────────────────────────────
  select 4, (tablename || '.' || policyname)::text,
    format(E'create policy %I on public.%I for %s to %s%s%s;',
      policyname, tablename, cmd, array_to_string(roles, ', '),
      coalesce(E'\n  using (' || qual || ')', ''),
      coalesce(E'\n  with check (' || with_check || ')', ''))
  from pg_policies
  where schemaname = 'public'

  union all

  -- ── 5. Funciones (incluye las 5 RPCs) ─────────────────────────────────────
  -- Filtra funciones de extensiones (uuid-ossp, etc.): solo las nuestras.
  select 5, p.proname::text, pg_get_functiondef(p.oid) || ';'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.prokind = 'f'
    and l.lanname in ('plpgsql', 'sql')
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.deptype = 'e'
    )

) t;
```

### Si la celda sale truncada

El editor recorta celdas muy largas. En ese caso corré la misma query cambiando
la última línea por una de estas, y copiá cada sección por separado:

```sql
) t where section = 1;   -- tablas
) t where section = 2;   -- constraints
) t where section = 3;   -- índices
) t where section = 4;   -- RLS
) t where section = 5;   -- funciones
```

### Plan B: cinco queries simples

Si la query de arriba tira error, estas cinco no usan `format()` ni `string_agg`
y devuelven filas normales. Copiá el resultado de cada una (el botón de export
del editor sirve).

```sql
-- 1. Columnas
select table_name, ordinal_position, column_name, data_type,
       character_maximum_length, numeric_precision, numeric_scale,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

```sql
-- 2. Constraints
select conrelid::regclass as tabla, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where connamespace = 'public'::regnamespace
order by 1, 2;
```

```sql
-- 3. Índices
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by 1, 2;
```

```sql
-- 4. Políticas RLS
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by 1, 2;
```

```sql
-- 5. Funciones
select proname, pg_get_functiondef(p.oid) as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in (
    'get_boot_data', 'get_dashboard_data', 'get_yearly_totals',
    'get_reflect_data', 'get_spending_overview', 'generate_recurring_expenses'
  )
order by 1;
```

### Alternativa con el CLI

Si tenés acceso a la connection string de Postgres, es un solo comando y no hace
falta nada de lo de arriba:

```bash
npx supabase db dump --db-url "$SUPABASE_DB_URL" --schema public -f supabase/schema.sql
```

(Project Settings → Database → Connection string, modo *Session*. Ojo que ahí va
la contraseña de la base.)
