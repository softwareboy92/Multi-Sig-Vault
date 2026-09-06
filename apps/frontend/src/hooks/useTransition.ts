import { useEffect, useRef, useState } from "react";

/**
 * Manages mount/unmount lifecycle with CSS enter/exit animations.
 *
 * @param show - Whether the element should be visible
 * @param exitDurationMs - How long to keep mounted after hiding (for exit animation)
 * @returns { mounted, visible } where:
 *   - mounted: whether the element should be in the DOM
 *   - visible: whether the enter animation class should be applied
 *
 * Usage:
 *   const { mounted, visible } = useTransition(isOpen, 200);
 *   if (!mounted) return null;
 *   return <div className={visible ? 'animate-scale-in' : 'animate-scale-out'}>...
 */
export function useTransition(show: boolean, exitDurationMs = 200) {
  const [mounted, setMounted] = useState(show);
  const [visible, setVisible] = useState(show);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (show) {
      // Mount immediately, then mark visible on next frame for enter animation
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
        });
      });
    } else {
      // Hide immediately (triggers exit animation), unmount after duration
      setVisible(false);
      timerRef.current = setTimeout(() => {
        setMounted(false);
      }, exitDurationMs);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [show, exitDurationMs]);

  return { mounted, visible };
}
