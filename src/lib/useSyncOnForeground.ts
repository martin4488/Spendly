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
 * Realtime is loaded as its own chunk, and only after the view has mounted: the
 * library is ~20 kB gz and opening a WebSocket during boot competed with the
 * queries that actually put pixels on screen. Trigger #1 is wired up
 * synchronously, so cross-device sync works from the first frame either way.
 *
 * Bursts (realtime + focus firing together) are throttled into a single refetch.
 */

import { useEffect, useRef } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_REALTIME_URL, getAccessToken, auth } from '@/lib/supabase';

const THROTTLE_MS = 1500;

// One shared realtime client for the whole app — mirrors what supabase-js kept
// on the client instance, including re-authing it when the token changes.
type RealtimeClientInstance = InstanceType<
  typeof import('@supabase/realtime-js')['RealtimeClient']
>;

let clientPromise: Promise<RealtimeClientInstance> | null = null;

function getRealtimeClient(): Promise<RealtimeClientInstance> {
  if (!clientPromise) {
    clientPromise = import('@supabase/realtime-js').then(({ RealtimeClient }) => {
      // The `accessToken` callback is what feeds the socket its JWT — including
      // on reconnect — so we never pin a token by passing one to setAuth() here.
      // The listener below mirrors supabase-js: re-auth on refresh/sign-in, drop
      // the token on sign-out.
      const client = new RealtimeClient(SUPABASE_REALTIME_URL, {
        params: { apikey: SUPABASE_ANON_KEY },
        accessToken: getAccessToken,
      });
      auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') client.setAuth();
        else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') client.setAuth(session?.access_token);
      });
      return client;
    });
  }
  return clientPromise;
}

export function useSyncOnForeground(userId: string, onSync: () => void) {
  // Keep the latest callback without re-subscribing on every render.
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  const lastSyncRef = useRef(0);

  useEffect(() => {
    if (!userId) return;

    let disposed = false;

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

    // Deferred: the subscription is a nice-to-have, the listeners above are not.
    const subscribed = getRealtimeClient()
      .then(client => {
        if (disposed) return null;
        const channel = client
          .channel(`expenses-sync-${userId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'expenses', filter: `user_id=eq.${userId}` },
            () => sync(),
          )
          .subscribe();
        return { client, channel };
      })
      .catch(() => null);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', sync);
      subscribed.then(active => {
        if (active) active.client.removeChannel(active.channel);
      });
    };
  }, [userId]);
}
