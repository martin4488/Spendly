/**
 * useSyncOnForeground.ts
 *
 * Keeps a view in sync across devices/tabs without a manual reload.
 *
 * Two complementary triggers:
 *  1. Foreground refetch — when the app/tab regains visibility or focus (e.g. you
 *     switch back from another app, or unlock your phone), it refetches. This is the
 *     zero-config path that fixes "I added an expense on my phone but my laptop still
 *     shows the old total until I reload".
 *  2. Supabase Realtime — subscribes to INSERT/UPDATE/DELETE on `expenses` for this
 *     user, so a change on any device pushes a live update while both are open.
 *     Requires the table to be in the `supabase_realtime` publication
 *     (see supabase/schema.sql). If realtime isn't enabled, trigger #1 still works.
 *
 * Bursts (realtime + focus firing together) are throttled into a single refetch.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

const THROTTLE_MS = 1500;

export function useSyncOnForeground(userId: string, onSync: () => void) {
  // Keep the latest callback without re-subscribing on every render.
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  const lastSyncRef = useRef(0);

  useEffect(() => {
    if (!userId) return;

    const sync = () => {
      const now = Date.now();
      if (now - lastSyncRef.current < THROTTLE_MS) return;
      lastSyncRef.current = now;
      onSyncRef.current();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', sync);

    const channel = supabase
      .channel(`expenses-sync-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `user_id=eq.${userId}` },
        () => sync(),
      )
      .subscribe();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', sync);
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
