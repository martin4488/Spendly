# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # ESLint via next lint
```

There is no test suite.

## Environment

Requires two env vars (copy from Supabase project settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

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

**Global currency state:** A module-level variable in [src/lib/utils.ts](src/lib/utils.ts) holds the active currency. Set it via `setDefaultCurrency(code)` at boot; read via `getDefaultCurrency()` or pass to `formatCurrency()`.

**Database (Supabase):** All tables (`categories`, `expenses`, `recurring_expenses`, `budgets`, `budget_categories`, `user_settings`) have Row Level Security — queries are automatically scoped to `auth.uid()`. Schema lives in [supabase/schema.sql](supabase/schema.sql). Key RPCs: `get_boot_data`, `generate_recurring_expenses`.

**Auth:** Email/password only. `detectSessionInUrl: false` on the Supabase client to skip URL-token parsing on every load. Auth state drives the `unauthenticated` flag in `page.tsx`; `AuthPage` is lazy-loaded since it's rarely needed.

**Supported currencies:** EUR, USD, ARS (see `CURRENCIES` in [src/lib/currency.ts](src/lib/currency.ts)).
