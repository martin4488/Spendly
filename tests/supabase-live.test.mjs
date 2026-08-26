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
    if (data.has_budgets_rpc === undefined) {
      // spendly_health() es de 005; 006 le agrega estos campos.
      console.warn('[spendly] spendly_health() sin los campos de 006 — aplicá supabase/migrations/006_budgets_rpc.sql');
    } else if (data.has_budgets_rpc) {
      assert.equal(Number(data.budget_period_duplicates), 0,
        'budget_periods tiene períodos duplicados — el índice único de 006 no se pudo crear (ver BLOQUE F de verify.sql)');
      assert.equal(data.idx_budget_periods_unique, true,
        'idx_budget_periods_unique falta — migration 006 no aplicada del todo');
    }

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

  test('get_budgets_data returns the shape BudgetsView reads', async (t) => {
    // Migración 006. Mientras no esté aplicada, BudgetsView usa el camino de
    // respaldo y anda igual — por eso esto se saltea en vez de fallar.
    const today = toDateStr(new Date());
    const { data, error } = await client.rpc('get_budgets_data', {
      p_user_id: userId,
      p_today: today,
    });

    if (error && (error.code === 'PGRST202' || /does not exist/i.test(error.message || ''))) {
      t.skip('get_budgets_data no existe todavía — aplicá supabase/migrations/006_budgets_rpc.sql');
      return;
    }
    assert.equal(error, null, `get_budgets_data failed: ${error?.message}`);

    for (const k of ['budgets', 'periods', 'global_periods', 'monthly_totals']) {
      assert.ok(Array.isArray(data[k]), `${k} should be an array, got ${typeof data[k]}`);
    }

    // Los totales por mes tienen que coincidir con la tabla. Si esta suma se
    // separa, el widget global miente y nada más se entera.
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const { data: rows, error: rowsError } = await client
      .from('expenses').select('amount, date')
      .eq('user_id', userId).gte('date', yearStart).lte('date', today);
    assert.equal(rowsError, null, `expenses select failed: ${rowsError?.message}`);

    const expected = new Map();
    for (const e of rows) {
      const mo = e.date.slice(0, 7);
      expected.set(mo, (expected.get(mo) || 0) + Number(e.amount));
    }
    for (const row of data.monthly_totals) {
      // El RPC llega hasta fin de mes; la consulta de arriba hasta hoy. Sólo se
      // comparan los meses completos.
      if (row.month === today.slice(0, 7)) continue;
      assert.ok(
        Math.abs(Number(row.total) - (expected.get(row.month) || 0)) < 0.01,
        `monthly_totals[${row.month}] = ${row.total}, la tabla dice ${expected.get(row.month)}`,
      );
    }

    for (const p of data.periods) {
      assert.ok(Number.isFinite(Number(p.spent)), `period ${p.id} sin spent numérico`);
      assert.ok(p.period_start <= p.period_end, `period ${p.id} termina antes de empezar`);
    }

    // Todo presupuesto ya arrancado tiene que tener un período que contenga hoy:
    // es el que abre BudgetDetailView al tocar la fila.
    for (const b of data.budgets) {
      if (b.start_date > today) continue;
      const cur = data.periods.find(
        p => p.budget_id === b.id && p.period_start <= today && p.period_end >= today,
      );
      assert.ok(cur, `el presupuesto "${b.name}" no tiene período vigente`);
      assert.ok(Array.isArray(b.category_ids), `"${b.name}" sin category_ids`);
    }
  });

  test('get_budgets_data no duplica períodos si se la llama dos veces', async (t) => {
    // Materializa los períodos que faltan, así que la idempotencia no es un
    // detalle: la vista se refresca al volver del segundo plano y en cada sync.
    const today = toDateStr(new Date());
    const args = { p_user_id: userId, p_today: today };

    const first = await client.rpc('get_budgets_data', args);
    if (first.error && (first.error.code === 'PGRST202' || /does not exist/i.test(first.error.message || ''))) {
      t.skip('get_budgets_data no existe todavía — aplicá supabase/migrations/006_budgets_rpc.sql');
      return;
    }
    assert.equal(first.error, null, `get_budgets_data failed: ${first.error?.message}`);

    const second = await client.rpc('get_budgets_data', args);
    assert.equal(second.error, null, `segunda llamada falló: ${second.error?.message}`);

    const key = p => `${p.budget_id}|${p.period_start}`;
    const ids = second.data.periods.map(key);
    assert.equal(new Set(ids).size, ids.length, 'la segunda llamada generó períodos duplicados');
    assert.equal(second.data.periods.length, first.data.periods.length,
      'la segunda llamada cambió la cantidad de períodos');
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

  test('get_budgets_data: períodos, expansión de subcategorías y monto heredado', {
    skip: allowWrites ? false : 'set SPENDLY_TEST_ALLOW_WRITES=1 to enable writes',
  }, async (t) => {
    // El único test que ejercita de verdad la matemática de la RPC. Los de
    // arriba comprueban la forma, pero la cuenta de prueba no tiene
    // presupuestos, así que sin armar uno acá el gasto por período nunca se
    // verifica contra nada — y es lo que decide lo que muestra la pantalla.
    //
    // Crea todo con el prefijo [spendly-test] y lo borra en el finally.
    const now = new Date();
    const today = toDateStr(now);
    const mo = n => {
      const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    };
    const lastDay = m => {
      const [y, mm] = m.split('-').map(Number);
      return `${m}-${pad(new Date(y, mm, 0).getDate())}`;
    };
    const [M2, M1, M0] = [mo(2), mo(1), mo(0)];

    const catIds = [];
    let budgetId = null;
    const expenseIds = [];

    const newCat = async (name, parent_id) => {
      const { data, error } = await client.from('categories')
        .insert({ user_id: userId, name: `[spendly-test] ${name}`, icon: 'package', color: '#123456', parent_id })
        .select().single();
      assert.equal(error, null, `crear categoría ${name} falló: ${error?.message}`);
      catIds.push(data.id);
      return data.id;
    };

    try {
      const padre = await newCat('Padre', null);
      const hija = await newCat('Hija', padre);
      // Fuera del presupuesto: su gasto no tiene que sumar en ningún período.
      const ajena = await newCat('Ajena', null);

      const { data: budget, error: bErr } = await client.from('budgets')
        .insert({
          user_id: userId, name: '[spendly-test] Presupuesto', amount: 100,
          recurrence: 'monthly', start_date: `${M2}-01`,
        })
        .select().single();
      assert.equal(bErr, null, `crear presupuesto falló: ${bErr?.message}`);
      budgetId = budget.id;

      // Apunta SÓLO al padre: la hija tiene que entrar por la expansión del CTE.
      const { error: bcpErr } = await client.from('budget_category_periods')
        .insert({ budget_id: budgetId, category_id: padre, valid_from: `${M2}-01`, valid_to: null });
      assert.equal(bcpErr, null, `vincular categoría falló: ${bcpErr?.message}`);

      for (const [month, category_id, amount] of [
        [M2, padre, 30], [M2, hija, 20],   // → 50
        [M1, hija, 140],                    // → 140
        [M0, padre, 11], [M0, ajena, 999],  // → 11, la ajena queda afuera
      ]) {
        const id = crypto.randomUUID();
        const { error } = await client.from('expenses').insert({
          id, user_id: userId, amount, description: '[spendly-test]',
          notes: null, category_id, date: `${month}-05`,
        });
        assert.equal(error, null, `insertar gasto falló: ${error?.message}`);
        expenseIds.push(id);
      }

      // ── La llamada ────────────────────────────────────────────────────────
      const { data, error } = await client.rpc('get_budgets_data', { p_user_id: userId, p_today: today });
      if (error && (error.code === 'PGRST202' || /does not exist/i.test(error.message || ''))) {
        t.skip('get_budgets_data no existe todavía — aplicá supabase/migrations/006_budgets_rpc.sql');
        return;
      }
      assert.equal(error, null, `get_budgets_data failed: ${error?.message}`);

      const b = data.budgets.find(x => x.id === budgetId);
      assert.ok(b, 'el presupuesto no vino en la respuesta');
      assert.deepEqual(b.category_ids, [padre], 'category_ids trae la semilla, no las expandidas');

      const mine = data.periods.filter(p => p.budget_id === budgetId)
        .sort((x, y) => x.period_start.localeCompare(y.period_start));
      assert.deepEqual(mine.map(p => p.period_start.slice(0, 7)), [M2, M1, M0],
        'tendría que haber materializado un período por mes desde start_date');

      // Fin de mes: el bug de UTC que arregla dateUtils daba el mes anterior.
      for (const p of mine) {
        assert.equal(p.period_end, lastDay(p.period_start.slice(0, 7)),
          `el período ${p.period_start} termina en ${p.period_end}`);
      }

      assert.equal(Number(mine[0].spent), 50, `${M2}: 30 del padre + 20 de la hija`);
      assert.equal(Number(mine[1].spent), 140, `${M1}: la hija sola`);
      assert.equal(Number(mine[2].spent), 11, `${M0}: 11 — si da 1010 se coló la categoría ajena`);

      const cur = mine.find(p => p.period_start <= today && p.period_end >= today);
      assert.ok(cur, 'no hay período que contenga a hoy — la fila del presupuesto no se podría abrir');

      // ── Idempotencia ──────────────────────────────────────────────────────
      const { error: e2 } = await client.rpc('get_budgets_data', { p_user_id: userId, p_today: today });
      assert.equal(e2, null, `segunda llamada falló: ${e2?.message}`);
      const { data: rows } = await client.from('budget_periods').select('id').eq('budget_id', budgetId);
      assert.equal(rows.length, 3, `la tabla quedó con ${rows.length} períodos — se duplicaron`);

      // ── Monto heredado ────────────────────────────────────────────────────
      // Se le pone monto propio al mes del medio y se borra el actual: al
      // regenerarlo tiene que heredar ese monto, como hacía el cliente.
      await client.from('budget_periods').update({ amount: 777 }).eq('id', mine[1].id);
      await client.from('budget_periods').delete().eq('id', mine[2].id);

      const { data: third, error: e3 } = await client.rpc('get_budgets_data', { p_user_id: userId, p_today: today });
      assert.equal(e3, null, `tercera llamada falló: ${e3?.message}`);
      const regen = third.periods.filter(p => p.budget_id === budgetId)
        .sort((x, y) => x.period_start.localeCompare(y.period_start));
      assert.equal(regen.length, 3, 'no se regeneró el período borrado');
      assert.equal(Number(regen[2].amount), 777, 'el mes nuevo tiene que heredar el último monto fijado');
      assert.equal(Number(regen[2].spent), 11, 'el gasto del período regenerado se perdió');
    } finally {
      // Los gastos primero: referencian a las categorías.
      for (const id of expenseIds) await client.from('expenses').delete().eq('id', id);
      // Borrar el presupuesto cascadea períodos y budget_category_periods.
      if (budgetId) await client.from('budgets').delete().eq('id', budgetId);
      for (const id of catIds.slice().reverse()) await client.from('categories').delete().eq('id', id);

      const { data: left } = await client.from('categories')
        .select('id').eq('user_id', userId).like('name', '%spendly-test%');
      assert.deepEqual(left, [], 'quedaron categorías de prueba sin borrar');
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
