/**
 * Live smoke test — drives the real client against the real Supabase project.
 *
 * The contract test proves we emit the same HTTP as supabase-js. This one proves
 * the other half: that the project on the other end accepts it — RLS, the RPCs,
 * the auth guard, realtime.
 *
 * Why it's worth keeping thorough: every view falls back to slow client-side
 * queries when its RPC errors, and swallows the error. So a broken RPC is
 * invisible in the UI — it just gets slower. Three separate real bugs were found
 * this way (a `date >= text` comparison in two functions, a dropped overload,
 * and a guard that could have locked the app out). Each has a test below.
 *
 * It SKIPS ITSELF unless credentials are present, so `npm test` stays green on a
 * fresh clone. To enable, create `.env.local` (see `.env.example`):
 *
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
 *   SPENDLY_TEST_EMAIL=...
 *   SPENDLY_TEST_PASSWORD=...
 *
 * Read-only by default. The write round-trip only runs with
 * SPENDLY_TEST_ALLOW_WRITES=1, and cleans up after itself.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient } from '../src/lib/supabaseClient.ts';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.SPENDLY_TEST_EMAIL;
const password = process.env.SPENDLY_TEST_PASSWORD;
const allowWrites = process.env.SPENDLY_TEST_ALLOW_WRITES === '1';

const configured = Boolean(url && key && email && password);
const skip = configured
  ? false
  : 'no credentials — set NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SPENDLY_TEST_EMAIL / SPENDLY_TEST_PASSWORD in .env.local';

const pad = n => String(n).padStart(2, '0');
const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: k => void map.delete(k),
  };
}

describe('live Supabase', { skip }, () => {
  let client;
  let userId;
  const year = new Date().getFullYear();

  before(async () => {
    client = createSupabaseClient({
      url,
      key,
      storageKey: 'spendly-auth-test',
      storage: memoryStorage(),
      // Don't leave a refresh timer running past the test process.
      autoRefreshToken: false,
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    assert.equal(error, null, `sign-in failed: ${error?.message}`);
    assert.ok(data.session?.access_token, 'expected a session');
    userId = data.user.id;
  });

  after(async () => {
    await client?.auth.signOut().catch(() => {});
  });

  // ── Schema health ─────────────────────────────────────────────────────────

  test('schema: every migration is applied', async () => {
    // Structural facts PostgREST can't otherwise reach — index existence,
    // function guards, leftover redundant indexes. Without this they'd only be
    // checkable by hand in the SQL Editor, which in practice means once.
    const { data, error } = await client.rpc('spendly_health');
    assert.equal(
      error,
      null,
      `spendly_health failed: ${error?.message} — apply supabase/migrations/005_health_check.sql`,
    );

    assert.equal(data.idx_expenses_recurring, true,
      'idx_expenses_recurring missing — migration 001 not applied');
    assert.equal(Number(data.recurring_updates_in_body), 1,
      'generate_recurring_expenses still writes last_generated inside the loop — migration 001 not applied');
    assert.equal(Number(data.reflect_overloads), 1,
      'get_reflect_data still has two overloads — PostgREST may fail to pick one (PGRST203)');
    assert.equal(Number(data.rpcs_with_guard), Number(data.rpcs_expected),
      `only ${data.rpcs_with_guard}/${data.rpcs_expected} RPCs carry the auth guard — migration 002 not fully applied`);
    assert.deepEqual(data.redundant_indexes, [],
      `redundant indexes still present: ${JSON.stringify(data.redundant_indexes)} — run migration 003`);
    assert.equal(Number(data.recurring_triggers), 0,
      'a trigger calls generate_recurring_expenses — the 002 auth guard will break it (auth.uid() is null there)');
    assert.equal(data.pg_cron_installed, false,
      'pg_cron is installed — check that no job calls the guarded RPCs, since auth.uid() is null in cron');
  });

  // ── Auth & RLS ────────────────────────────────────────────────────────────

  test('REST calls carry the user JWT (RLS scopes to this user)', async () => {
    const { data, error } = await client.from('expenses').select('id, user_id').limit(20);
    assert.equal(error, null, `select failed: ${error?.message}`);
    assert.ok(Array.isArray(data));
    for (const row of data) {
      assert.equal(row.user_id, userId, "RLS returned another user's row");
    }
  });

  test('RPCs refuse to serve another user (migration 002 guard)', async () => {
    // These are SECURITY DEFINER and bypass RLS, so without an explicit
    // auth.uid() check anyone with the (public) anon key could read another
    // account by passing its UUID.
    const { data, error } = await client.rpc('get_boot_data', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_recent_start: `${year}-01-01`,
      p_chart_start: `${year}-01-01`,
    });
    assert.ok(
      error,
      'get_boot_data returned data for a foreign user id — migrations/002_rpc_hardening.sql is not applied',
    );
    assert.match(
      `${error.message} ${error.code ?? ''}`,
      /not authorized|42501/,
      `expected a 42501 not-authorized error, got: ${JSON.stringify(error)}`,
    );
    assert.equal(data, null);
  });

  // ── Each RPC: responds AND returns the shape the app reads ────────────────
  // Asserting the shape (not just "no error") is what catches a function that
  // returns successfully but with nothing usable in it.

  test('get_boot_data returns the shape page.tsx reads', async () => {
    const recentStart = new Date();
    recentStart.setDate(recentStart.getDate() - 30);
    const sixMonthsAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1);

    const { data, error } = await client.rpc('get_boot_data', {
      p_user_id: userId,
      p_recent_start: toDateStr(recentStart),
      p_chart_start: `${sixMonthsAgo.getFullYear()}-${pad(sixMonthsAgo.getMonth() + 1)}-01`,
    });

    assert.equal(error, null, `get_boot_data failed: ${error?.message}`);
    assert.ok(data, 'get_boot_data returned nothing');
    assert.ok(Array.isArray(data.categories), 'categories must be an array');
    assert.ok(Array.isArray(data.recent_expenses), 'recent_expenses must be an array');
    assert.ok(Array.isArray(data.monthly_totals), 'monthly_totals must be an array');
    // page.tsx does `boot.currency || 'EUR'`, so null is tolerated but a missing
    // key would mean the function changed shape.
    assert.ok('currency' in data, 'currency key must be present');

    for (const row of data.monthly_totals) {
      assert.match(row.month, /^\d{4}-\d{2}$/, 'monthly_totals.month must be YYYY-MM');
      assert.ok(Number.isFinite(Number(row.total)), 'monthly_totals.total must be numeric');
    }
  });

  test('get_boot_data returns the NEWEST expenses, not an arbitrary 500', async () => {
    // The function LIMITs to 500 rows. Before migration 002 the LIMIT ran
    // without an ORDER BY, so a busy month could return 500 arbitrary rows and
    // sort them afterwards — the dashboard would silently miss recent expenses.
    const recentStart = new Date();
    recentStart.setDate(recentStart.getDate() - 30);
    const { data, error } = await client.rpc('get_boot_data', {
      p_user_id: userId,
      p_recent_start: toDateStr(recentStart),
      p_chart_start: toDateStr(recentStart),
    });
    assert.equal(error, null, `get_boot_data failed: ${error?.message}`);

    const dates = data.recent_expenses.map(e => e.date);
    const sorted = [...dates].sort().reverse();
    assert.deepEqual(dates, sorted, 'recent_expenses must come back newest-first');

    // If we hit the cap, the newest row must still be the newest one that exists.
    if (data.recent_expenses.length === 500) {
      const { data: newest } = await client
        .from('expenses')
        .select('date')
        .gte('date', toDateStr(recentStart))
        .order('date', { ascending: false })
        .limit(1);
      assert.equal(dates[0], newest[0].date, 'the 500-row cap dropped the newest expenses');
    }
  });

  test('get_dashboard_data returns the shape DashboardView reads', async () => {
    const { data, error } = await client.rpc('get_dashboard_data', {
      p_user_id: userId,
      p_recent_start: `${year}-01-01`,
      p_chart_start: `${year}-01-01`,
    });
    assert.equal(error, null, `get_dashboard_data failed: ${error?.message}`);
    assert.ok(Array.isArray(data.recent_expenses));
    assert.ok(Array.isArray(data.monthly_totals));
  });

  test('get_reflect_data works with the string dates the app sends', async () => {
    // Regression: the (uuid, text, text) overload compared `date >= p_year_start`
    // with no cast. There is no `date >= text` operator, so it raised 42883 and
    // ReflectView fell back to pulling every expense of the year into JS.
    // Fixed by migrations/004_fix_date_casts.sql.
    const { data, error } = await client.rpc('get_reflect_data', {
      p_user_id: userId,
      p_year_start: `${year}-01-01`,
      p_year_end: `${year}-12-31`,
    });
    assert.equal(
      error,
      null,
      `get_reflect_data failed: ${error?.message} — check migrations/004_fix_date_casts.sql`,
    );
    assert.ok(Array.isArray(data.monthly_totals), 'monthly_totals must be an array');
    assert.ok(Array.isArray(data.category_totals), 'category_totals must be an array');
    for (const row of data.category_totals) {
      assert.match(row.month, /^\d{4}-\d{2}$/);
      assert.ok(row.category_id, 'category_totals rows must carry a category_id');
    }
  });

  test('get_spending_overview works with the string dates the app sends', async () => {
    // Same `date >= text` bug as get_reflect_data, but with no working overload
    // to mask it — this one had been failing in production unnoticed.
    const { data, error } = await client.rpc('get_spending_overview', {
      p_user_id: userId,
      p_start_date: `${year}-01-01`,
      p_end_date: `${year}-12-31`,
    });
    assert.equal(
      error,
      null,
      `get_spending_overview failed: ${error?.message} — check migrations/004_fix_date_casts.sql`,
    );
    assert.ok(Array.isArray(data.category_totals), 'category_totals must be an array');
    assert.ok(Number.isFinite(Number(data.total)), 'total must be numeric');
    for (const row of data.category_totals) {
      assert.ok(Number.isFinite(Number(row.total)));
      assert.ok(Number.isFinite(Number(row.tx_count)));
    }
  });

  test('get_yearly_totals returns one row per year with data', async () => {
    const { data, error } = await client.rpc('get_yearly_totals', {
      p_user_id: userId,
      p_start_year: year - 5,
      p_end_year: year,
    });
    assert.equal(error, null, `get_yearly_totals failed: ${error?.message}`);
    assert.ok(Array.isArray(data));
    for (const row of data) {
      assert.ok(Number.isInteger(row.year), 'year must be an integer');
      assert.ok(Number.isFinite(Number(row.total)));
    }
  });

  // ── Plain queries the app relies on ───────────────────────────────────────

  test('categoryCache query works', async () => {
    const { data, error } = await client
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .neq('deleted', true)
      .order('position')
      .order('created_at');
    assert.equal(error, null, `categories select failed: ${error?.message}`);
    assert.ok(Array.isArray(data));
  });

  test('BudgetsView queries work', async () => {
    const { data: budgets, error: budgetsError } = await client
      .from('budgets').select('*').eq('user_id', userId).order('name');
    assert.equal(budgetsError, null, `budgets select failed: ${budgetsError?.message}`);

    const ids = budgets.map(b => b.id);
    if (ids.length === 0) return;

    const [{ error: bcError }, { error: periodsError }] = await Promise.all([
      client.from('budget_category_periods')
        .select('budget_id, category_id').in('budget_id', ids).is('valid_to', null),
      client.from('budget_periods')
        .select('id, budget_id, period_start, period_end, amount').in('budget_id', ids),
    ]);
    assert.equal(bcError, null, `budget_category_periods failed: ${bcError?.message}`);
    assert.equal(periodsError, null, `budget_periods failed: ${periodsError?.message}`);
  });

  // ── Realtime ──────────────────────────────────────────────────────────────

  test('realtime connects and subscribes to expenses', { timeout: 20000 }, async () => {
    // Realtime is dynamically imported by useSyncOnForeground, so a bundling or
    // auth mistake there wouldn't show up anywhere else.
    const { RealtimeClient } = await import('@supabase/realtime-js');
    const rt = new RealtimeClient(client.realtimeUrl, {
      params: { apikey: client.anonKey },
      accessToken: client.getAccessToken,
    });

    const channel = rt.channel(`expenses-sync-${userId}`).on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'expenses', filter: `user_id=eq.${userId}` },
      () => {},
    );

    try {
      const status = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for SUBSCRIBED')), 15000);
        channel.subscribe(s => {
          if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
            clearTimeout(timer);
            resolve(s);
          }
        });
      });
      assert.equal(
        status,
        'SUBSCRIBED',
        'realtime did not subscribe — check that `expenses` is in the supabase_realtime publication',
      );
    } finally {
      await rt.removeChannel(channel).catch(() => {});
      rt.disconnect();
    }
  });

  // ── Writes (opt-in) ───────────────────────────────────────────────────────

  test('insert → read back → delete', { skip: allowWrites ? false : 'set SPENDLY_TEST_ALLOW_WRITES=1 to enable writes' }, async () => {
    const id = crypto.randomUUID();
    const row = {
      id,
      user_id: userId,
      amount: 0.01,
      description: '[spendly-test] borrar si aparece',
      notes: null,
      category_id: null,
      date: toDateStr(new Date()),
    };

    const { error: insertError } = await client.from('expenses').insert(row);
    assert.equal(insertError, null, `insert failed: ${insertError?.message}`);

    try {
      const { data, error } = await client
        .from('expenses').select('id, amount, description').eq('id', id).single();
      assert.equal(error, null, `read-back failed: ${error?.message}`);
      assert.equal(data.id, id);
      assert.equal(Number(data.amount), 0.01);
    } finally {
      const { error: deleteError } = await client.from('expenses').delete().eq('id', id);
      assert.equal(deleteError, null, `cleanup failed — row ${id} may still exist: ${deleteError?.message}`);
    }
  });

  test('generate_recurring_expenses is callable', { skip: allowWrites ? false : 'set SPENDLY_TEST_ALLOW_WRITES=1 to enable writes' }, async () => {
    // Called at boot from page.tsx with `.catch(console.error)`, so a failure
    // here is completely silent in the app. It's idempotent: it only inserts
    // periods that don't already exist.
    const { error } = await client.rpc('generate_recurring_expenses', { p_user_id: userId });
    assert.equal(error, null, `generate_recurring_expenses failed: ${error?.message}`);
  });
});
