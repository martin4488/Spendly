/**
 * supabase.ts — the app-wide client singleton.
 *
 * The actual wiring lives in `supabaseClient.ts` (kept env-free so the contract
 * test can import it under Node). This file only resolves configuration.
 */

import { createSupabaseClient } from '@/lib/supabaseClient';

// Fall back to harmless placeholders when the env vars are absent so the build
// (which prerenders `/` and instantiates this client at module load) doesn't
// crash. On Vercel the real NEXT_PUBLIC_ values are inlined at build time, so
// this fallback never applies in production; a build without them simply
// produces an app that can't reach the backend.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn('[supabase] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — using placeholders. The app will not connect to a backend.');
}

const client = createSupabaseClient({
  url: supabaseUrl,
  key: supabaseAnonKey,
  storageKey: 'spendly-auth',
});

export const auth = client.auth;
export const getAccessToken = client.getAccessToken;
export const SUPABASE_ANON_KEY = client.anonKey;
export const SUPABASE_REALTIME_URL = client.realtimeUrl;

/**
 * Drop-in stand-in for the `createClient()` result, limited to what the app
 * actually calls. Realtime lives in `useSyncOnForeground`, not here.
 */
export const supabase = {
  auth: client.auth,
  from: client.from,
  rpc: client.rpc,
};
