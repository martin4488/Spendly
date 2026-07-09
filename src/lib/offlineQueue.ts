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

const listeners = new Set<Listener>();
let flushing = false;
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

/** Remove a still-unsynced expense from the queue (e.g. user deletes it). */
export function dequeueExpense(id: string): void {
  write(read().filter((e) => e.id !== id));
}

/** Client-side id so an offline row is stable and dedups on sync. */
export function newExpenseId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function flushQueue(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (read().length === 0) return;

  flushing = true;
  try {
    for (const item of read()) {
      const { queued_at, ...row } = item;
      try {
        const { error } = await supabase.from('expenses').insert(row);
        if (error && (error as { code?: string }).code !== '23505') {
          // Server responded with a real rejection (not a duplicate) → permanent.
          console.error('Pending expense rejected, dropping:', error);
          toast('Un gasto pendiente no se pudo sincronizar y fue descartado.');
        }
        // success OR duplicate (already synced) OR permanent rejection → remove it
        write(read().filter((e) => e.id !== item.id));
      } catch {
        // fetch rejected → still offline. Keep this item and the rest; retry later.
        break;
      }
    }
  } finally {
    flushing = false;
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
