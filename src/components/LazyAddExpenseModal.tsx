'use client';

import { lazy, useState, type ComponentProps, type ComponentType } from 'react';
import type AddExpenseModalType from '@/components/AddExpenseModal';

// The add-expense modal is the most-used screen in the app, but it lives in its
// own chunk to keep it out of the boot bundle. Two things made opening it lag:
// AppShell only warmed the chunk on idle (up to 4 s after launch — exactly when
// people tap "+"), and `React.lazy` suspends on its first render even when the
// module is already loaded, so the first open of every view painted nothing for
// a tick. `preloadAddExpenseModal()` starts the import right after first paint,
// and once it has landed the wrapper renders the real component directly.

type Props = ComponentProps<typeof AddExpenseModalType>;

let loaded: ComponentType<Props> | null = null;
let pending: Promise<{ default: ComponentType<Props> }> | null = null;

export function preloadAddExpenseModal() {
  if (!pending) {
    pending = import('@/components/AddExpenseModal').then(m => {
      loaded = m.default;
      return m;
    });
    // Offline before the chunk was ever cached: let the next call retry.
    pending.catch(() => { pending = null; });
  }
  return pending;
}

const Lazy = lazy(preloadAddExpenseModal);

export default function AddExpenseModal(props: Props) {
  // Chosen once per mount: swapping Lazy → loaded later would remount the modal
  // and drop whatever was typed.
  const [Comp] = useState(() => loaded ?? Lazy);
  return <Comp {...props} />;
}
