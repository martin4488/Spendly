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

`npm test` runs two suites out of `tests/`:

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

**Database (Supabase):** Nine tables, all with Row Level Security. [supabase/schema.sql](supabase/schema.sql) is a complete dump (tables, constraints, indexes, RLS, RPCs); [supabase/README.md](supabase/README.md) has the query to regenerate it and the list of pending migrations in [supabase/migrations/](supabase/migrations/).

Two things to know before touching the database:
- **The RPCs are `SECURITY DEFINER` and filter on the `p_user_id` argument, not `auth.uid()`** — so they bypass RLS and currently let any caller read another user's data. `migrations/002_rpc_hardening.sql` fixes it; until that's applied, don't add new RPCs on this pattern.
- **`generate_recurring_expenses` in the database is much richer than a naive reading suggests** (handles `start_date`, `end_date`, `day_of_month`, month-end clamping). Always dump the live definition before rewriting it. `migrations/001_performance.sql` holds the current source of truth.

`budget_categories` is a legacy table superseded by `budget_category_periods`; nothing in the app reads it.

**Auth:** Email/password only. `detectSessionInUrl: false` on the Supabase client to skip URL-token parsing on every load. Auth state drives the `unauthenticated` flag in `page.tsx`; `AuthPage` is lazy-loaded since it's rarely needed. Note that restoring a persisted session emits **two** events (`SIGNED_IN` then `INITIAL_SESSION`), so `page.tsx` dedupes the boot RPC via `runUnifiedBootOnce`.

**Service worker** ([public/sw.js](public/sw.js)): hashed assets are cache-first; HTML navigations are stale-while-revalidate so launches don't block on the network. When revalidation finds a new shell it posts `shell-updated` and [ServiceWorkerRegistrar](src/components/ServiceWorkerRegistrar.tsx) reloads once the page goes to the background. Bump `CACHE_VERSION` to force a purge.

**Supported currencies:** EUR, USD, ARS (see `CURRENCIES` in [src/lib/currency.ts](src/lib/currency.ts)).
