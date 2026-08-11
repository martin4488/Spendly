/**
 * rpcFallback.ts
 *
 * Every view that calls a Supabase RPC has a fallback: if the RPC errors, it
 * rebuilds the same result with plain client-side queries. That's good for
 * resilience and terrible for visibility — a broken RPC never surfaces as an
 * error, only as "the app feels slow". Three real bugs lived in production this
 * way (two functions comparing `date >= text`, and a dropped overload).
 *
 * So: still fall back, but say so. In production this is a `console.warn`
 * (kept by next.config.js, which only strips `log`/`info`). In development it
 * also raises a toast, because a warning in a console nobody has open is the
 * same as no warning at all.
 *
 * Offline is not reported — falling back with no network is expected, not a
 * defect, and crying wolf there would train everyone to ignore this.
 */

import { toast } from '@/lib/toast';

const reported = new Set<string>();

interface SupabaseErrorish {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * Record that `rpcName` failed and the caller is about to do the slow thing.
 *
 * @param rpcName the Postgres function that failed, e.g. 'get_reflect_data'
 * @param error   the error Supabase returned (may be null if it just came back empty)
 * @param view    where it happened, for the message
 */
export function reportRpcFallback(rpcName: string, error: SupabaseErrorish | null, view: string): void {
  // Offline: the fallback queries will fail too, and the view has its own
  // offline state. Nothing to report.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  // One report per RPC per session — this fires on every refresh otherwise.
  const key = `${rpcName}:${error?.code ?? 'empty'}`;
  if (reported.has(key)) return;
  reported.add(key);

  const detail = error
    ? `${error.code ? `[${error.code}] ` : ''}${error.message ?? 'unknown error'}`
    : 'returned no data';

  console.warn(
    `[spendly] RPC ${rpcName}() failed in ${view} — falling back to client-side queries, ` +
    `which are much slower. This is invisible to users; fix the function. Cause: ${detail}`,
    error ?? '',
  );

  if (process.env.NODE_ENV !== 'production') {
    toast(`RPC ${rpcName} falló — la vista está usando el camino lento. Mirá la consola.`, 'info');
  }
}

/** Test/debug helper: which RPCs have fallen back this session. */
export function getRpcFallbacks(): string[] {
  return Array.from(reported);
}
