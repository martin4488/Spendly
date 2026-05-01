'use client';

import { useState, useRef, memo, useEffect } from 'react';
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
 * Touch handlers are attached natively as PASSIVE listeners (default), letting the
 * browser scroll without waiting for our handlers to run — fewer jank frames.
 */
const SwipeableRow = memo(function SwipeableRow({
  children,
  onTap,
  onDelete,
  className = '',
}: SwipeableRowProps) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const startXRef = useRef<number | null>(null);
  const currentXRef = useRef<number>(0);
  // Mirror state in refs so passive handlers don't need re-binding on every render
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    function handleStart(e: TouchEvent) {
      startXRef.current = e.touches[0].clientX;
      setIsDragging(false);
    }
    function handleMove(e: TouchEvent) {
      if (startXRef.current === null) return;
      const dx = startXRef.current - e.touches[0].clientX;
      if (dx > 5) setIsDragging(true);
      if (dx > 0) {
        currentXRef.current = Math.min(dx, DELETE_THRESHOLD);
        setOffset(currentXRef.current);
      } else if (dx < 0 && offsetRef.current > 0) {
        currentXRef.current = Math.max(0, offsetRef.current + dx);
        setOffset(currentXRef.current);
      }
    }
    function handleEnd() {
      if (currentXRef.current > SNAP_THRESHOLD) setOffset(DELETE_THRESHOLD);
      else setOffset(0);
      startXRef.current = null;
    }

    // passive: true → does not block scroll → smoother UX
    el.addEventListener('touchstart', handleStart, { passive: true });
    el.addEventListener('touchmove', handleMove, { passive: true });
    el.addEventListener('touchend', handleEnd, { passive: true });
    el.addEventListener('touchcancel', handleEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleStart);
      el.removeEventListener('touchmove', handleMove);
      el.removeEventListener('touchend', handleEnd);
      el.removeEventListener('touchcancel', handleEnd);
    };
  }, []);

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
        ref={innerRef}
        style={{
          transform: `translateX(-${offset}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease',
          // Hint compositor — animated transform stays on GPU layer
          willChange: isDragging ? 'transform' : 'auto',
        }}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  );
});

export default SwipeableRow;
