/**
 * offlineQueue.ts
 *
 * A tiny offline write queue for expense inserts. When the network is down, a new
 * expense is stored in localStorage with a client-generated id and shown
 * optimistically; when connectivity returns it's flushed to Supabase.
 *
 * Scope is deliberately limited to *inserting expenses* (see the design decision
 * in chat): this avoids the hard parts of a general offline layer — ordering /
 * FK dependencies, and edit/delete conflict resolution.
 *
 * Robustness details:
 *  - Client-generated id → the optimistic row is stable and dedups against the
 *    Realtime echo once the insert lands.
 *  - Transient failure (fetch rejects → still offline) keeps the item and stops,
 *    retrying later. Permanent failure (server responds with an error) drops the
 *    item and notifies, so one bad row can't block the queue forever.
 *  - A duplicate-key error (23505) means the row already synced (e.g. the app
 *    closed after insert but before dequeue) → treated as success, silently.
 */

import { supabase } from './supabase';
import { toast } from './toast';

const KEY = 'spendly_pending_expenses';

export interface PendingExpense {
  id: string;
  user_id: string;
  amount: number;
  description: string | null;
  notes: null;
  category_id: string;
  date: string;
  original_currency: string | null;
  original_amount: number | null;
  queued_at: number;
}

type Listener = () => void;
type SyncedListener = (rows: PendingExpense[]) => void;

const listeners = new Set<Listener>();
const syncedListeners = new Set<SyncedListener>();
let flushChain: Promise<void> = Promise.resolve();
let autoFlushStarted = false;

function read(): PendingExpense[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as PendingExpense[];
  } catch {
    return [];
  }
}

function write(items: PendingExpense[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // storage full/unavailable — nothing we can do
  }
  listeners.forEach((l) => l());
}

/** Subscribe to queue changes (add/remove). Returns an unsubscribe fn. */
export function onQueueChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getPendingExpenses(userId: string): PendingExpense[] {
  return read().filter((e) => e.user_id === userId);
}

export function enqueueExpense(item: PendingExpense): void {
  write([...read(), item]);
}

/**
 * Rows the server just accepted, notified *before* they leave the queue. Without
 * it a synced expense vanished from the Dashboard — its pending copy was removed
 * — until the reload that follows brought it back as a server row.
 */
export function onExpensesSynced(fn: SyncedListener): () => void {
  syncedListeners.add(fn);
  return () => { syncedListeners.delete(fn); };
}

function notifySynced(rows: PendingExpense[]): void {
  if (rows.length === 0) return;
  syncedListeners.forEach((fn) => { try { fn(rows); } catch { /* ignore */ } });
}

/** Remove a still-unsynced expense from the queue (e.g. user deletes it). */
export function dequeueExpense(id: string): void {
  write(read().filter((e) => e.id !== id));
}

/** Client-side id so an offline row is stable and dedups on sync. */
export function newExpenseId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Send everything queued. Calls are serialized rather than dropped: the
 * add-expense modal awaits this to know its row landed, and returning early
 * because another flush was mid-flight (which read the queue before the new row
 * was added) resolved before the row was sent.
 */
export function flushQueue(): Promise<void> {
  flushChain = flushChain.then(flushOnce).catch(console.error);
  return flushChain;
}

async function flushOnce(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (read().length === 0) return;

  // Sólo se mandan los gastos del usuario que está firmado ahora.
  //
  // Sin este filtro, si otra persona entra en el mismo dispositivo con gastos
  // ajenos todavía en la cola, sus inserts salen con el JWT nuevo y RLS los
  // rechaza por `user_id` ajeno. Y un rechazo del servidor acá cuenta como
  // permanente: el bucle de abajo los descartaba, o sea que le borraba a la
  // primera persona gastos que nunca llegaron a guardarse. Quedan en la cola
  // hasta que vuelva a entrar.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return;

  const mine = (items: PendingExpense[]) => items.filter(e => e.user_id === userId);
  const queued = mine(read());
  if (queued.length === 0) return;

  // Camino feliz: un solo INSERT con todo. Volver de un vuelo con varios gastos
  // encolados hacía un viaje por gasto (y una reescritura de localStorage por
  // cada uno). Si el lote falla por lo que sea, se cae al bucle de a uno, que
  // es el que sabe distinguir duplicado de rechazo real.
  if (queued.length > 1) {
    try {
      const rows = queued.map(({ queued_at, ...row }) => row);
      const { error } = await supabase.from('expenses').insert(rows);
      if (!error) {
        notifySynced(queued);
        const done = new Set(queued.map(e => e.id));
        write(read().filter(e => !done.has(e.id)));
        return;
      }
    } catch {
      // Red caída: sigue todo encolado, se reintenta después.
      return;
    }
  }

  for (const item of mine(read())) {
    const { queued_at, ...row } = item;
    try {
      const { error } = await supabase.from('expenses').insert(row);
      if (error && (error as { code?: string }).code !== '23505') {
        // Server responded with a real rejection (not a duplicate) → permanent.
        console.error('Pending expense rejected, dropping:', error);
        toast('Un gasto pendiente no se pudo sincronizar y fue descartado.');
      } else {
        notifySynced([item]);
      }
      // success OR duplicate (already synced) OR permanent rejection → remove it
      write(read().filter((e) => e.id !== item.id));
    } catch {
      // fetch rejected → still offline. Keep this item and the rest; retry later.
      break;
    }
  }
}

/**
 * Idempotently flush now and whenever the browser reconnects. Call once from a
 * mounted client component.
 */
export function startAutoFlush(): void {
  if (typeof window === 'undefined') return;
  flushQueue();
  if (autoFlushStarted) return;
  autoFlushStarted = true;
  window.addEventListener('online', () => { flushQueue(); });
}
