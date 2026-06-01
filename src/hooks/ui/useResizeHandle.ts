/**
 * useResizeHandle Hook
 *
 * Shared hook for panel resize functionality used across Workstation apps.
 * Handles mouse drag to resize panels with configurable constraints.
 *
 * PERFORMANCE: Uses requestAnimationFrame throttling to prevent forced reflows
 * during mousemove events. Without RAF, rapid getBoundingClientRect/clientX
 * reads can cause layout thrashing.
 *
 * Used by:
 * - DatabaseManager (left panel resize)
 * - Browser (left panel resize)
 * - BrowserInspector (DevTools panel resize)
 * - CodeEditor BottomPanel (vertical resize)
 */
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ============================================
// Types
// ============================================

export interface UseResizeHandleOptions {
  /** Resize direction */
  direction: "horizontal" | "vertical";
  /** Minimum size in pixels */
  minSize: number;
  /** Maximum size in pixels */
  maxSize: number;
  /** Whether resize direction is reversed (e.g., right-mode layout) */
  isReversed?: boolean;
  /** Callback when resize completes */
  onResizeEnd?: () => void;
}

export interface UseResizeHandleReturn {
  /** Mouse down handler for the resize handle */
  handleMouseDown: (event: ReactMouseEvent) => void;
  /** True after the first mousemove during a resize until mouseup (for handle visuals). */
  isResizing: boolean;
}

// ============================================
// Hook Implementation
// ============================================

/**
 * Hook for managing panel resize interactions.
 *
 * @param currentSize - Current size value (controlled)
 * @param onSizeChange - Callback to update size
 * @param options - Configuration options
 * @returns Object with handleMouseDown for the resize handle
 *
 * @example
 * ```tsx
 * import { VerticalResizeHandle } from "@src/scaffold/Resize";
 *
 * const { handleMouseDown } = useResizeHandle(
 *   leftPanelWidth,
 *   setLeftPanelWidth,
 *   { direction: 'horizontal', minSize: 200, maxSize: 500 }
 * );
 *
 * return (
 *   <VerticalResizeHandle onMouseDown={handleMouseDown} />
 * );
 * ```
 */
export function useResizeHandle(
  currentSize: number,
  onSizeChange: (size: number) => void,
  options: UseResizeHandleOptions
): UseResizeHandleReturn {
  const {
    direction,
    minSize,
    maxSize,
    isReversed = false,
    onResizeEnd,
  } = options;

  const [isResizing, setIsResizing] = useState(false);

  // Use ref to track current size during drag (avoids stale closure)
  const sizeRef = useRef(currentSize);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    sizeRef.current = currentSize;
  }, [currentSize]);

  // Cleanup drag listeners on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      setIsResizing(false);
    };
  }, []);

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();

      const startPos =
        direction === "horizontal" ? event.clientX : event.clientY;
      const startSize = sizeRef.current;
      let hasDragged = false;

      // Store latest mouse position for RAF callback
      let latestPos = startPos;

      const applyResize = () => {
        rafIdRef.current = null;

        let delta = latestPos - startPos;
        if (isReversed) {
          delta = -delta;
        }

        if (direction === "vertical") {
          delta = -delta;
        }

        const newSize = Math.max(minSize, Math.min(maxSize, startSize + delta));
        onSizeChange(newSize);
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        if (!hasDragged) {
          hasDragged = true;
          setIsResizing(true);
          document.body.style.cursor =
            direction === "horizontal" ? "col-resize" : "row-resize";
          document.body.style.userSelect = "none";
        }

        // Capture latest position
        latestPos =
          direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY;

        // RAF throttle: only schedule if no pending frame
        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(applyResize);
        }
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        // Cancel any pending RAF
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        setIsResizing(false);
        if (hasDragged) {
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
        onResizeEnd?.();
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      dragCleanupRef.current = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        setIsResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    },
    [direction, minSize, maxSize, isReversed, onSizeChange, onResizeEnd]
  );

  return { handleMouseDown, isResizing };
}

export default useResizeHandle;
