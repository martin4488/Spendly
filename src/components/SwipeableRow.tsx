'use client';

import { useState, useRef, memo } from 'react';
import { Trash2 } from 'lucide-react';

const DELETE_THRESHOLD = 72;
const SNAP_THRESHOLD = 36;

interface SwipeableRowProps {
  children: React.ReactNode;
  onTap?: () => void;
  onDelete: () => void;
  /** Extra classes on the outer wrapper (e.g. rounded-xl) */
  className?: string;
}

/**
 * Generic swipe-to-reveal-delete row.
 * Used in DashboardView, SpendingOverview, RecurringView, etc.
 */
const SwipeableRow = memo(function SwipeableRow({
  children,
  onTap,
  onDelete,
  className = '',
}: SwipeableRowProps) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const currentXRef = useRef<number>(0);

  function onTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0].clientX;
    setIsDragging(false);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startXRef.current === null) return;
    const dx = startXRef.current - e.touches[0].clientX;
    if (dx > 5) setIsDragging(true);
    if (dx > 0) {
      currentXRef.current = Math.min(dx, DELETE_THRESHOLD);
      setOffset(currentXRef.current);
    } else if (dx < 0 && offset > 0) {
      currentXRef.current = Math.max(0, offset + dx);
      setOffset(currentXRef.current);
    }
  }

  function onTouchEnd() {
    if (currentXRef.current > SNAP_THRESHOLD) {
      setOffset(DELETE_THRESHOLD);
    } else {
      setOffset(0);
    }
    startXRef.current = null;
  }

  function handleClick() {
    if (isDragging) return;
    if (offset > 0) { setOffset(0); return; }
    onTap?.();
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Delete button revealed on swipe */}
      <div
        className="absolute right-0 top-0 bottom-0 flex items-center justify-center bg-red-500"
        style={{ width: DELETE_THRESHOLD }}
      >
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="flex flex-col items-center justify-center w-full h-full gap-1 active:bg-red-600 transition-colors"
        >
          <Trash2 size={18} className="text-white" />
          <span className="text-[10px] text-white font-medium">Borrar</span>
        </button>
      </div>

      {/* Sliding content */}
      <div
        style={{
          transform: `translateX(-${offset}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  );
});

export default SwipeableRow;
