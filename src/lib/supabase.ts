import { createClient } from '@supabase/supabase-js';

// Fall back to harmless placeholders when the env vars are absent so the build
// (which prerenders `/` and instantiates this client at module load) doesn't
// crash with "supabaseUrl is required". On Vercel the real NEXT_PUBLIC_ values
// are inlined at build time, so this fallback never applies in production; a
// build without them simply produces an app that can't reach the backend.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn('[supabase] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — using placeholders. The app will not connect to a backend.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Disabled — Spendly uses email/password auth only, no OAuth callbacks.
    // This avoids parsing the URL for tokens on every page load, which speeds
    // up the INITIAL_SESSION event by ~50-100ms.
    detectSessionInUrl: false,
    storageKey: 'spendly-auth',
  },
});
