import { memo, useMemo } from 'react';
import { getIconComponent } from '@/lib/iconMap';

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
  const Icon = getIconComponent(icon);
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
      <Icon size={iSize} color="white" strokeWidth={1.8} />
    </div>
  );
}

const CategoryIcon = memo(CategoryIconInner);
export default CategoryIcon;
