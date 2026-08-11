import { memo, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from '@/lib/iconComponents';

// ── Deferred icon components ─────────────────────────────────────────────────
// The lucide registry is ~47 kB of ESM and this component renders on the
// dashboard, so importing it statically put all of it in front of first paint.
// We kick the chunk off at module load — parallel with boot, not on first render
// — and paint the coloured tile immediately, fading the glyph in when it lands.
// After the first visit the service worker serves it from cache.

let registry: { getIconComponent: (key: string) => LucideIcon } | null = null;
let pending: Promise<void> | null = null;
const waiters = new Set<() => void>();

function loadRegistry(): Promise<void> {
  if (registry) return Promise.resolve();
  if (!pending) {
    pending = import('@/lib/iconComponents')
      .then(mod => {
        registry = mod;
        // One notify for every mounted icon; React 18 batches these into a
        // single render pass.
        waiters.forEach(fn => fn());
        waiters.clear();
      })
      .catch(() => {
        // Offline before the chunk was ever cached — tiles stay glyph-less
        // rather than breaking the list.
        pending = null;
      });
  }
  return pending;
}

if (typeof window !== 'undefined') loadRegistry();

/** Re-render once the icon registry is available. No-op if it already is. */
function useIconRegistry(): typeof registry {
  const [, bump] = useState(0);
  useEffect(() => {
    if (registry) return;
    const notify = () => bump(n => n + 1);
    waiters.add(notify);
    loadRegistry();
    return () => { waiters.delete(notify); };
  }, []);
  return registry;
}

// ── Lighten a hex color for gradient end ─────────────────────────────────────
function lightenHex(hex: string, amount: number = 30): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lighten = (c: number) => Math.min(255, c + amount);
  return `#${lighten(r).toString(16).padStart(2, '0')}${lighten(g).toString(16).padStart(2, '0')}${lighten(b).toString(16).padStart(2, '0')}`;
}

interface CategoryIconProps {
  icon: string;   // lucide key (e.g. "shopping-cart") or legacy emoji
  color: string;  // hex base color
  size?: number;  // container size in px (default 36)
  iconSize?: number; // lucide icon size (default: auto based on container)
  className?: string;
  rounded?: 'md' | 'lg' | 'xl' | 'full'; // border-radius preset
}

const roundedMap = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
};

function CategoryIconInner({ icon, color, size = 36, iconSize, className = '', rounded = 'lg' }: CategoryIconProps) {
  const icons = useIconRegistry();
  const Icon = icons?.getIconComponent(icon);
  const iSize = iconSize ?? Math.round(size * 0.5);
  const gradientEnd = useMemo(() => lightenHex(color, 40), [color]);

  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 ${roundedMap[rounded]} ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${color}, ${gradientEnd})`,
      }}
    >
      {Icon && (
        <Icon size={iSize} color="white" strokeWidth={1.8} style={{ animation: 'iconFadeIn 0.15s ease-out' }} />
      )}
    </div>
  );
}

const CategoryIcon = memo(CategoryIconInner);
export default CategoryIcon;
