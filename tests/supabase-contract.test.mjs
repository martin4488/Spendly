/**
 * Contract test: the hand-assembled client vs. the real thing.
 *
 * `src/lib/supabaseClient.ts` replaces `createClient()` from
 * `@supabase/supabase-js` to keep storage-js, functions-js and realtime-js out
 * of the boot chunk. That's only safe as long as it emits *byte-identical HTTP*
 * for everything the app does.
 *
 * So: build both clients over the same fake fetch, drive them through the exact
 * calls the app makes, and diff every request — method, URL, query string, body
 * and the headers that carry meaning. `@supabase/supabase-js` stays pinned as a
 * devDependency purely to be the reference; it never ships.
 *
 * Needs no network and no credentials. Run with `npm test`.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../src/lib/supabaseClient.ts';

const URL_BASE = 'https://demo.supabase.co';
const ANON_KEY = 'anon-key-for-tests';
const STORAGE_KEY = 'spendly-auth';

// Headers that actually change server behaviour. `x-client-info` is telemetry
// and legitimately differs (we don't send it), so it's excluded on purpose.
const MEANINGFUL_HEADERS = [
  'apikey',
  'authorization',
  'content-type',
  'accept',
  'prefer',
  'range',
  'accept-profile',
  'content-profile',
];

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: k => void map.delete(k),
  };
}

/** Records every request instead of performing it. */
function recordingFetch(log) {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const picked = {};
    for (const name of MEANINGFUL_HEADERS) {
      if (headers.has(name)) picked[name] = headers.get(name);
    }
    const parsed = new global.URL(url);
    log.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      origin: parsed.origin,
      path: parsed.pathname,
      // Sorted so an ordering difference between the two builders isn't a
      // false positive — the server treats query params as a set.
      query: [...parsed.searchParams.entries()].sort((a, b) =>
        a[0] === b[0] ? String(a[1]).localeCompare(String(b[1])) : a[0].localeCompare(b[0]),
      ),
      headers: picked,
      body: init?.body ?? null,
    });
    return new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

/** A non-expired session, in the shape auth-js persists. */
function seededSession(accessToken) {
  return JSON.stringify({
    access_token: accessToken,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', aud: 'authenticated', role: 'authenticated' },
  });
}

function buildPair(seed) {
  const mineLog = [];
  const refLog = [];

  const mine = createSupabaseClient({
    url: URL_BASE,
    key: ANON_KEY,
    storageKey: STORAGE_KEY,
    fetch: recordingFetch(mineLog),
    storage: memoryStorage(seed ? { [STORAGE_KEY]: seed } : {}),
    autoRefreshToken: false,
  });

  const reference = createClient(URL_BASE, ANON_KEY, {
    auth: {
      storageKey: STORAGE_KEY,
      storage: memoryStorage(seed ? { [STORAGE_KEY]: seed } : {}),
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: recordingFetch(refLog) },
  });

  return { mine, reference, mineLog, refLog };
}

/**
 * The operations the app actually performs, each pulled from a real call site.
 * `c` is either client — they expose the same `from`/`rpc` surface.
 */
const OPERATIONS = [
  ['DashboardView: recent expenses', c =>
    c.from('expenses')
      .select('id, amount, description, date, category_id, is_recurring')
      .eq('user_id', 'user-1')
      .gte('date', '2026-07-11')
      .order('date', { ascending: false })
      .limit(500)],

  ['DashboardView: chart totals fallback', c =>
    c.from('expenses')
      .select('date, amount')
      .eq('user_id', 'user-1')
      .gte('date', '2026-03-01')
      .limit(10000)],

  ['DashboardView: month range', c =>
    c.from('expenses')
      .select('id, amount, description, date, category_id, is_recurring')
      .eq('user_id', 'user-1')
      .gte('date', '2026-05-01')
      .lte('date', '2026-05-31')
      .order('date', { ascending: false })
      .limit(500)],

  ['page.tsx: get_boot_data', c =>
    c.rpc('get_boot_data', {
      p_user_id: 'user-1',
      p_recent_start: '2026-07-11',
      p_chart_start: '2026-03-01',
    })],

  ['DashboardView: get_yearly_totals', c =>
    c.rpc('get_yearly_totals', { p_user_id: 'user-1', p_start_year: 2021, p_end_year: 2026 })],

  ['SpendingOverview: get_spending_overview', c =>
    c.rpc('get_spending_overview', {
      p_user_id: 'user-1',
      p_start_date: '2026-08-01',
      p_end_date: '2026-08-31',
    })],

  ['categoryCache: categories', c =>
    c.from('categories')
      .select('*')
      .eq('user_id', 'user-1')
      .neq('deleted', true)
      .order('position')
      .order('created_at')],

  ['CategoriesView: visible categories', c =>
    c.from('categories')
      .select('*')
      .eq('user_id', 'user-1')
      .neq('deleted', true)
      .neq('hidden', true)
      .order('position')
      .order('created_at')],

  ['BudgetsView: active budget categories', c =>
    c.from('budget_category_periods')
      .select('budget_id, category_id')
      .in('budget_id', ['b1', 'b2'])
      .is('valid_to', null)],

  ['BudgetsView: expenses by category', c =>
    c.from('expenses')
      .select('category_id, amount, date')
      .eq('user_id', 'user-1')
      .in('category_id', ['c1', 'c2', 'c3'])
      .gte('date', '2026-01-01')
      .lte('date', '2026-08-10')],

  ['BudgetsView: insert periods returning rows', c =>
    c.from('budget_periods')
      .insert([{ budget_id: 'b1', period_start: '2026-08-01', period_end: '2026-08-31', amount: 500 }])
      .select()],

  ['AddExpenseModal: insert expense', c =>
    c.from('expenses').insert({
      id: 'e-new',
      user_id: 'user-1',
      amount: 12.5,
      description: 'Café',
      notes: null,
      category_id: 'c1',
      date: '2026-08-10',
      original_currency: null,
      original_amount: null,
    })],

  ['AddExpenseModal: update expense', c =>
    c.from('expenses')
      .update({ amount: 20, description: 'Café doble', category_id: 'c1', date: '2026-08-10' })
      .eq('id', 'e-1')],

  ['DashboardView: delete expense', c =>
    c.from('expenses').delete().eq('id', 'e-1')],

  ['CategoriesView: reorder upsert', c =>
    c.from('categories').upsert(
      [
        { id: 'c1', user_id: 'user-1', name: 'Casa', position: 0 },
        { id: 'c2', user_id: 'user-1', name: 'Comida', position: 1 },
      ],
      { onConflict: 'id' },
    )],

  ['BudgetsView: global budget upsert', c =>
    c.from('global_budget_periods').upsert(
      [{ user_id: 'user-1', month: '2026-08', amount: 1500 }],
      { onConflict: 'user_id,month' },
    )],

  ['page.tsx: user settings single()', c =>
    c.from('user_settings').select('default_currency').eq('user_id', 'user-1').single()],

  ['ReflectView: first expense date', c =>
    c.from('expenses').select('date').eq('user_id', 'user-1').order('date', { ascending: true }).limit(1)],
];

// Auth clients initialize asynchronously (they emit INITIAL_SESSION on a
// microtask); let both settle before recording so their init traffic — if any —
// doesn't interleave with the operations under test.
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 250));
}

for (const signedIn of [false, true]) {
  const label = signedIn ? 'signed in' : 'signed out';
  const seed = signedIn ? seededSession('user-jwt-abc123') : null;

  test(`REST requests match supabase-js (${label})`, async () => {
    const { mine, reference, mineLog, refLog } = buildPair(seed);
    await settle();

    for (const [name, run] of OPERATIONS) {
      mineLog.length = 0;
      refLog.length = 0;

      await run(mine);
      await run(reference);

      assert.equal(mineLog.length, 1, `${name}: expected exactly one request from our client`);
      assert.equal(refLog.length, 1, `${name}: expected exactly one request from supabase-js`);
      assert.deepEqual(mineLog[0], refLog[0], `${name}: request differs from supabase-js`);
    }
  });

  test(`Authorization header carries the right token (${label})`, async () => {
    const { mine, mineLog } = buildPair(seed);
    await settle();

    mineLog.length = 0;
    await mine.from('expenses').select('id').eq('user_id', 'user-1');

    const expected = signedIn ? 'Bearer user-jwt-abc123' : `Bearer ${ANON_KEY}`;
    assert.equal(mineLog[0].headers.authorization, expected);
    assert.equal(mineLog[0].headers.apikey, ANON_KEY);
  });
}

test('auth event sequence matches supabase-js when a session is restored', async () => {
  const { mine, reference } = buildPair(seededSession('user-jwt-abc123'));

  const mineEvents = [];
  const refEvents = [];
  mine.auth.onAuthStateChange((event, session) => mineEvents.push([event, session?.access_token ?? null]));
  reference.auth.onAuthStateChange((event, session) => refEvents.push([event, session?.access_token ?? null]));

  await settle();

  assert.deepEqual(mineEvents, refEvents, 'our auth client must emit exactly what supabase-js does');

  // Restoring a session fires TWO events, not one. `page.tsx` treats both as a
  // boot trigger, so it needs `runUnifiedBootOnce` to dedupe them — otherwise
  // every cold start issues `get_boot_data` twice. If this expectation ever
  // changes, revisit that guard.
  assert.deepEqual(mineEvents, [
    ['SIGNED_IN', 'user-jwt-abc123'],
    ['INITIAL_SESSION', 'user-jwt-abc123'],
  ]);
});

test('auth emits a single INITIAL_SESSION with no session when signed out', async () => {
  const { mine, reference } = buildPair(null);
  const mineEvents = [];
  const refEvents = [];
  mine.auth.onAuthStateChange((event, session) => mineEvents.push([event, session]));
  reference.auth.onAuthStateChange((event, session) => refEvents.push([event, session]));
  await settle();
  assert.deepEqual(mineEvents, refEvents);
  // page.tsx relies on this exact event to flip to the unauthenticated state.
  assert.deepEqual(mineEvents, [['INITIAL_SESSION', null]]);
});

test('realtime URL matches supabase-js', async () => {
  const { mine } = buildPair(null);
  // supabase-js keeps `realtimeUrl` protected, so assert the documented shape
  // it produces: same origin, ws(s) scheme, /realtime/v1 path.
  assert.equal(mine.realtimeUrl, 'wss://demo.supabase.co/realtime/v1');

  const insecure = createSupabaseClient({ url: 'http://localhost:54321', key: ANON_KEY });
  assert.equal(insecure.realtimeUrl, 'ws://localhost:54321/realtime/v1');
});

test('getAccessToken falls back to the anon key when signed out', async () => {
  const { mine } = buildPair(null);
  await settle();
  assert.equal(await mine.getAccessToken(), ANON_KEY);
});

test('getAccessToken returns the session JWT when signed in', async () => {
  const { mine } = buildPair(seededSession('user-jwt-abc123'));
  await settle();
  assert.equal(await mine.getAccessToken(), 'user-jwt-abc123');
});
