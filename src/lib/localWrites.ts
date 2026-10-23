/**
 * localWrites.ts — expense ids this device wrote in the last few seconds.
 *
 * Every write path here already reloads its own view when the write lands, and
 * Realtime then echoes the same change back, which triggered a second, identical
 * reload: two `get_dashboard_data` round-trips per saved expense. Writers note
 * the ids they touch and `useSyncOnForeground` drops the echo. Changes from other
 * devices carry ids we never noted, so they still sync.
 */

const TTL_MS = 10_000;
const recent = new Map<string, number>();

export function noteLocalWrite(ids: string | string[]): void {
  const now = Date.now();
  recent.forEach((t, id) => { if (now - t >= TTL_MS) recent.delete(id); });
  for (const id of Array.isArray(ids) ? ids : [ids]) recent.set(id, now);
}

export function isLocalWrite(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const t = recent.get(id);
  return t !== undefined && Date.now() - t < TTL_MS;
}
