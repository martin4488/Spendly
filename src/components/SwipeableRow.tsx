'use client';

import { useState, useRef, memo, useEffect, useCallback } from 'react';
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
 *
 * Touch handlers are attached natively as PASSIVE listeners, letting the browser
 * scroll without waiting for our handlers to run. The drag itself never goes
 * through React: every touchmove writes `style.transform` on the node directly,
 * so following a finger costs one style write instead of a render pass per frame
 * across a list that can be hundreds of rows long. React state only tracks
 * whether the row is *open*, which changes at most twice per gesture.
 */
const SwipeableRow = memo(function SwipeableRow({
  children,
  onTap,
  onDelete,
  className = '',
}: SwipeableRowProps) {
  // `revealed` only gates whether the delete button is mounted. It flips once when
  // a swipe starts and once when the row closes — never per frame.
  const [revealed, setRevealed] = useState(false);
  const revealedRef = useRef(false);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const startXRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const draggingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback((next: boolean) => {
    if (revealedRef.current === next) return;
    revealedRef.current = next;
    setRevealed(next);
  }, []);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    const paint = (offset: number, animate: boolean) => {
      offsetRef.current = offset;
      el.style.transition = animate ? 'transform 0.2s ease' : 'none';
      el.style.transform = `translateX(-${offset}px)`;
    };

    function handleStart(e: TouchEvent) {
      if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
      startXRef.current = e.touches[0].clientX + offsetRef.current;
      draggingRef.current = false;
      el!.style.willChange = 'transform';
    }
    function handleMove(e: TouchEvent) {
      if (startXRef.current === null) return;
      const dx = startXRef.current - e.touches[0].clientX;
      if (dx > 5) { draggingRef.current = true; reveal(true); }
      paint(Math.max(0, Math.min(dx, DELETE_THRESHOLD)), false);
    }
    function handleEnd() {
      if (startXRef.current === null) return;
      startXRef.current = null;
      el!.style.willChange = 'auto';
      const open = offsetRef.current > SNAP_THRESHOLD;
      paint(open ? DELETE_THRESHOLD : 0, true);
      // Unmount the button only once the row has finished sliding back over it.
      if (!open) closeTimerRef.current = setTimeout(() => reveal(false), 220);
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
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [reveal]);

  function handleClick() {
    if (draggingRef.current) return;
    if (offsetRef.current > 0) {
      const el = innerRef.current;
      if (el) {
        el.style.transition = 'transform 0.2s ease';
        el.style.transform = 'translateX(0px)';
      }
      offsetRef.current = 0;
      closeTimerRef.current = setTimeout(() => reveal(false), 220);
      return;
    }
    onTap?.();
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Delete button revealed on swipe — only mounted while the row is open, so
          a long list doesn't carry a button + icon per hidden row. */}
      {revealed && (
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
      )}

      {/* Sliding content */}
      <div ref={innerRef} style={{ transform: 'translateX(0px)' }} onClick={handleClick}>
        {children}
      </div>
    </div>
  );
});

export default SwipeableRow;
