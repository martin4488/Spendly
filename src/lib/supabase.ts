import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
