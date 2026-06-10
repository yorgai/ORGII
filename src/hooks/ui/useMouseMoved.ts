/**
 * useMouseMoved
 *
 * Returns a ref whose `.current` value is `true` only after the mouse has
 * physically moved since the hook was last reset. Use this to suppress
 * hover-triggered highlights in keyboard-driven menus: when a menu opens
 * under the cursor the hover fires immediately, but `.current` stays `false`
 * until the pointer actually moves, so keyboard navigation is unaffected.
 *
 * Usage:
 *   const mouseMovedRef = useMouseMoved(visible);
 *   // In onMouseEnter handlers:
 *   if (!mouseMovedRef.current) return;
 *   setHighlightIndex(idx);
 */
import { useEffect, useRef } from "react";

export function useMouseMoved(
  active: boolean
): React.MutableRefObject<boolean> {
  const movedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      movedRef.current = false;
      return;
    }

    // Reset every time the menu becomes active so each open cycle starts fresh.
    movedRef.current = false;

    const onMove = () => {
      movedRef.current = true;
    };

    window.addEventListener("mousemove", onMove, { once: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
    };
  }, [active]);

  return movedRef;
}
