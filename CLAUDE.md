# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (http://localhost:3000)
npm run build      # Production build
npm run lint       # ESLint via next lint
npm run typecheck  # tsc --noEmit
npm test           # node:test — see below
```

## Tests

`npm test` runs six suites out of `tests/`:

- **`supabase-contract.test.mjs`** — always runs, no network or credentials
  needed. The app does *not* use `createClient()` from `@supabase/supabase-js`
  (see "Supabase client" below); this test drives our hand-assembled client and
  a real supabase-js client through every query the app makes and asserts the
  HTTP requests are identical — method, host, path, query params, body and the
  meaningful headers. `@supabase/supabase-js` is a devDependency purely to serve
  as this reference and never ships. **Run this after touching
  `src/lib/supabaseClient.ts`.**
- **`supabase-live.test.mjs`** — skips itself unless `.env.local` has
  credentials. Signs in against the real project and checks RLS scoping, the
  migration-002 auth guard, every RPC's response *shape* (not just that it
  didn't error), `get_boot_data` ordering, the queries BudgetsView depends on,
  and that realtime subscribes. Read-only unless `SPENDLY_TEST_ALLOW_WRITES=1`.

  Keep this one thorough. **Every view silently falls back to slow client-side
  queries when its RPC errors** — so a broken RPC never surfaces as a bug
  report, only as "the app feels slow". Three real bugs were found exactly this
  way (see the comments in the file). Structural checks that PostgREST can't
  reach (indexes, function source, cron jobs) live in
  [supabase/verify.sql](supabase/verify.sql) instead.
- **`budgets-snapshot.test.mjs`** — always runs, no network. Fixtures over
  `buildSnapshot()`, the math both Budgets paths share. See "Budgets math".
- **`date-utils.test.mjs`** — always runs, no network. Re-runs the timezone-
  sensitive assertions in subprocesses under four timezones, because every bug
  it covers was invisible in UTC. See "Dates are local, never UTC" below.
- **`currency.test.mjs`** — always runs, `fetch` and `localStorage` stubbed.
  Pins the *failure* contract of conversion (no rates → `null`, never the input
  amount — that's what silently wrote 1000 ARS as 1000 EUR) and the single
  money format. See "Money formatting" below.
- **`csv.test.mjs`** — always runs, no network. The export and the import are
  two halves of one format, so this drives a round trip through both. See
  [src/lib/csv.ts](src/lib/csv.ts).

## Environment

Copy `.env.example` to `.env.local`. The app itself needs two vars (Supabase
project settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

`SPENDLY_TEST_*` are only for the live smoke test.

## Architecture

**Stack:** Next.js 14 (App Router), Supabase (Postgres + Auth), Tailwind CSS, TypeScript. Deployed to Vercel, installable as a PWA.

**Single-page shell pattern:** The entire authenticated UI lives in `AppShell` ([src/components/AppShell.tsx](src/components/AppShell.tsx)), which owns a `Tab` state and conditionally renders the active view. Navigation is done by calling `setActiveTab()` — there is no client-side router. All views are lazy-loaded via `React.lazy`.

**Boot flow** ([src/app/page.tsx](src/app/page.tsx)):
1. Reads `localStorage['spendly-auth']` synchronously to avoid a loading flash for returning users.
2. Calls the `get_boot_data` Supabase RPC which returns user settings, recent expenses, monthly chart totals, and categories in one round-trip.
3. Seeds the in-memory `categoryCache` and `dashboardCache` from the boot response.
4. Calls `generate_recurring_expenses` RPC (throttled to once/day via localStorage).

**Caching layer** (three separate caches):
- `categoryCache` ([src/lib/categoryCache.ts](src/lib/categoryCache.ts)) — in-memory singleton `Map<id, Category>`. Call `invalidateCategories()` after any category mutation.
- `dashboardCache` ([src/lib/dashboardCache.ts](src/lib/dashboardCache.ts)) — localStorage snapshot of expenses + chart totals. No TTL; always overwritten on boot. Displayed immediately on cold start while fresh data loads in the background.
- Currency rates ([src/lib/currency.ts](src/lib/currency.ts)) — localStorage, 1-hour TTL, fetched from `open.er-api.com` with USD as base.

**Global currency state:** A module-level variable in [src/lib/currencyState.ts](src/lib/currencyState.ts) holds the active currency, mirrored to localStorage so cold starts restore it synchronously. Set it via `setDefaultCurrency(code)` at boot; read via `getDefaultCurrency()` or pass to `formatCurrency()`. It lives in its own dependency-free module on purpose — it used to sit in `utils.ts`, which drags in date-fns and the icon registry.

**Supabase client** ([src/lib/supabaseClient.ts](src/lib/supabaseClient.ts)): assembled from `@supabase/auth-js` + `@supabase/postgrest-js` rather than `createClient()`, because the umbrella package also bundles storage-js and functions-js (never used) and realtime-js, together ~63 kB gz in the boot chunk. Realtime is dynamically imported by [useSyncOnForeground](src/lib/useSyncOnForeground.ts) after first paint. Behaviour is pinned by the contract test — see "Tests". [src/lib/supabase.ts](src/lib/supabase.ts) is just the env-configured singleton.

**Database (Supabase):** Nine tables, all with Row Level Security. [supabase/schema.sql](supabase/schema.sql) is a complete dump (tables, constraints, indexes, RLS, RPCs); [supabase/README.md](supabase/README.md) has the query to regenerate it, and tracks which of [supabase/migrations/](supabase/migrations/) are applied and which are still pending.

Three things to know before touching the database:
- **Every RPC is `SECURITY DEFINER` and filters on the `p_user_id` argument, not `auth.uid()`** — which bypasses RLS, so each one needs the identity guard `migrations/002_rpc_hardening.sql` added (`if auth.uid() is null or p_user_id <> auth.uid() then raise`). A new RPC without it lets any caller read another user's data with the public anon key. `spendly_health()` counts the guarded ones, and `npm test` asserts the count.
- **Every RPC also takes the date from the client, never `current_date`.** The server runs in UTC; at 21:00 in Buenos Aires it's already tomorrow there. See "Dates are local, never UTC".
- **`generate_recurring_expenses` in the database is much richer than a naive reading suggests** (handles `start_date`, `end_date`, `day_of_month`, month-end clamping). Always dump the live definition before rewriting it. `migrations/001_performance.sql` holds the current source of truth.

`budget_categories` is a legacy table superseded by `budget_category_periods`; nothing in the app reads it.

**Budgets math** ([src/lib/budgetsSnapshot.ts](src/lib/budgetsSnapshot.ts)): `buildSnapshot()` turns budgets + periods-with-spend into what the screen renders, and it is deliberately outside the view. Two paths feed it — the `get_budgets_data` RPC, which sums each period's spend in Postgres, and the client fallback, which sums it by hand. They must agree: if they drift, a broken RPC changes the numbers silently rather than failing. `tests/budgets-snapshot.test.mjs` pins the math with fixtures. The live suite builds a real budget (parent + child category, three months of expenses), asserts the RPC's per-period spend — subcategory rollup included, unrelated categories excluded — and deletes it again; that one is behind `SPENDLY_TEST_ALLOW_WRITES=1`, because the test account has no budgets of its own and without one the spend math is never checked against anything.

`get_budgets_data` is the only `get_*` that writes — it materializes any missing budget periods before aggregating, because on the first day of a new month the current period doesn't exist yet and the budget would render empty. It's idempotent, and the live test calls it twice to prove it.

**Auth:** Email/password only. `detectSessionInUrl: false` on the Supabase client to skip URL-token parsing on every load. Auth state drives the `unauthenticated` flag in `page.tsx`; `AuthPage` is lazy-loaded since it's rarely needed. Note that restoring a persisted session emits **two** events (`SIGNED_IN` then `INITIAL_SESSION`), so `page.tsx` dedupes the boot RPC via `runUnifiedBootOnce`.

**Service worker** ([public/sw.js](public/sw.js)): hashed assets are cache-first; HTML navigations are stale-while-revalidate so launches don't block on the network. When revalidation finds a new shell it posts `shell-updated` and [ServiceWorkerRegistrar](src/components/ServiceWorkerRegistrar.tsx) reloads once the page goes to the background. Bump `CACHE_VERSION` to force a purge.

**Dates are local, never UTC** ([src/lib/dateUtils.ts](src/lib/dateUtils.ts)): every
`yyyy-MM-dd` / `yyyy-MM` in this app is a *calendar* date, so two patterns are
banned and the helpers here replace them:

- `new Date().toISOString().split('T')[0]` — that's the UTC day. In UTC-3 an
  expense added after 21:00 got tomorrow's date.
- `new Date('2026-03-01')` — date-only ISO strings parse as UTC, landing on
  Feb 28 21:00 local, so `format(…, 'yyyy-MM')` returned the *previous* month.
  That's what made `saveMonthlyBudget`'s `while (m <= curMonth)` never advance.

Month arithmetic (`addMonthsStr`, `monthRange`, `monthEndStr`) is done on strings
and touches no `Date` at all. `date-fns`' `parseISO` is fine — it parses
date-only strings as local — but `new Date(str)` is not.
`tests/date-utils.test.mjs` pins this by re-running under four timezones.

**Supported currencies:** EUR, USD, ARS (see `CURRENCIES` in [src/lib/currency.ts](src/lib/currency.ts)). `DEFAULT_CURRENCY` in [src/lib/currencyState.ts](src/lib/currencyState.ts) is the one fallback for "we don't know this user's currency yet" — it used to be spelled out in three places that disagreed (EUR in `page.tsx`, USD everywhere else).

**Money formatting** ([src/lib/currency.ts](src/lib/currency.ts)): one
implementation, `amountParts()`, feeds both `formatWithCurrency()` (a plain
string; `formatCurrency` in `utils.ts` delegates to it) and
[`<Amount>`](src/components/ui/Amount.tsx), which renders the same pieces with
the decimals in a smaller span. They were two separate implementations on
different locales, and five views use both — so the same screen showed
`€1,234,567.89` next to `€1.234.567,89`. Format is es-AR: `€1.234.567,89`.

**"Today" is not a constant** ([src/lib/useLocalToday.ts](src/lib/useLocalToday.ts)):
this is an installed PWA that stays open for days, so anything deriving the
current day, month or year at mount goes stale. The Dashboard used to do exactly
that, which labelled today's expenses "Ayer" after midnight and left the chart on
last month's six-month window. The hook re-checks on a timer to local midnight
and on visibility/focus, and only changes identity when the day actually changed.

**Caches are only written on success.** `getCategories()` gets `{ data: null,
error }` from PostgREST on any failure — not an exception — and caching that
left an empty category map marked valid for the whole session: every expense row
read "Sin categoría" and the add-expense modal offered nothing, even after
reconnecting. Same shape of bug to watch for anywhere a `.then(({ data }) => …)`
ignores `error`.
