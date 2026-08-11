/**
 * supabaseClient.ts
 *
 * Assembles a Supabase client from `@supabase/auth-js` + `@supabase/postgrest-js`
 * instead of using `createClient()` from `@supabase/supabase-js`.
 *
 * Why: the umbrella package eagerly bundles storage-js, functions-js and
 * realtime-js alongside auth + postgrest. Spendly never touches storage or
 * functions, and it only uses realtime in one hook — yet all of it landed in the
 * boot chunk (~63 kB gz, the single biggest thing the app downloaded).
 *
 * The wiring below mirrors what SupabaseClient does — same URLs, same auth
 * headers, same "inject the current access token into every REST call" fetch
 * wrapper — so query and auth behaviour is unchanged. `tests/supabase-contract.test.mjs`
 * pins that down by driving this client and a real supabase-js client through
 * the same calls and diffing the HTTP requests they emit; run `npm test` after
 * touching anything here.
 *
 * This module is deliberately free of `@/` path aliases and of any reference to
 * `process.env`, so the test can import it directly under Node.
 */

import { AuthClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';

export interface SupabaseClientOptions {
  url: string;
  key: string;
  /** localStorage key for the persisted session. */
  storageKey?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to auth-js's own storage detection. */
  storage?: {
    getItem: (key: string) => string | null | Promise<string | null>;
    setItem: (key: string, value: string) => void | Promise<void>;
    removeItem: (key: string) => void | Promise<void>;
  };
  autoRefreshToken?: boolean;
  persistSession?: boolean;
}

type AuthClientInstance = InstanceType<typeof AuthClient>;

export interface SpendlySupabaseClient {
  auth: AuthClientInstance;
  from: (relation: string) => ReturnType<PostgrestClient['from']>;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
    options?: { head?: boolean; get?: boolean; count?: 'exact' | 'planned' | 'estimated' },
  ) => ReturnType<PostgrestClient['rpc']>;
  /** Current access token, falling back to the anon key when signed out. */
  getAccessToken: () => Promise<string>;
  /** ws(s):// endpoint for realtime — built the way SupabaseClient builds it. */
  realtimeUrl: string;
  anonKey: string;
}

export function createSupabaseClient(options: SupabaseClientOptions): SpendlySupabaseClient {
  const {
    url,
    key,
    storageKey,
    fetch: customFetch,
    storage,
    autoRefreshToken = true,
    persistSession = true,
  } = options;

  const baseUrl = new URL(url);
  const baseFetch: typeof fetch = customFetch ?? ((...args) => fetch(...args));

  const realtimeUrl = (() => {
    const u = new URL('realtime/v1', baseUrl);
    u.protocol = u.protocol.replace('http', 'ws');
    return u.href;
  })();

  const auth = new AuthClient({
    url: new URL('auth/v1', baseUrl).href,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    storageKey,
    storage,
    autoRefreshToken,
    persistSession,
    // Disabled — Spendly uses email/password auth only, no OAuth callbacks.
    // This avoids parsing the URL for tokens on every page load, which speeds
    // up the INITIAL_SESSION event by ~50-100ms.
    detectSessionInUrl: false,
    flowType: 'implicit',
    fetch: baseFetch,
  });

  const getAccessToken = async (): Promise<string> => {
    const { data } = await auth.getSession();
    return data.session?.access_token ?? key;
  };

  // Same shape as supabase-js's `fetchWithAuth`.
  const authedFetch: typeof fetch = async (input, init) => {
    const token = await getAccessToken();
    const headers = new Headers(init?.headers);
    if (!headers.has('apikey')) headers.set('apikey', key);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    return baseFetch(input, { ...init, headers });
  };

  const rest = new PostgrestClient(new URL('rest/v1', baseUrl).href, {
    fetch: authedFetch,
    // supabase-js defaults to this and it becomes the Accept-Profile /
    // Content-Profile headers. PostgREST would fall back to the same schema
    // without them, but the contract test diffs headers — keep it explicit.
    schema: 'public',
  });

  return {
    auth,
    from: relation => rest.from(relation),
    rpc: (fn, args, opts) => rest.rpc(fn, args, opts),
    getAccessToken,
    realtimeUrl,
    anonKey: key,
  };
}
