/**
 * useResizeController Hook
 *
 * Core hook for resize functionality. This is the most critical piece of the system.
 *
 * Key principles (from spec.md):
 * 1. mousemove phase = DOM world only (no React render)
 * 2. Only ghost layer changes during resize
 * 3. State commits only on mouseup
 * 4. All resize operations go through this controller
 *
 * Usage:
 * ```tsx
 * const { containerRef, ghostRef, start, isResizing } = useResizeController({
 *   axis: "x",
 *   min: 200,
 *   max: 600,
 *   onCommit: (size) => setWidth(size),
 * });
 * ```
 */
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { useResizeManager } from "../ResizeManager";
import type { ResizeControllerOptions, ResizeSession } from "../types";

// ============================================
// Types
// ============================================

export interface UseResizeControllerReturn {
  /** Ref for the container element */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Ref for the ghost layer element */
  ghostRef: RefObject<HTMLDivElement | null>;
  /** Start resize handler */
  start: (event: ReactMouseEvent, currentSize: number) => void;
  /** Whether currently resizing */
  isResizing: boolean;
  /** Current preview size (only valid during resize) */
  previewSize: number | null;
}

// ============================================
// Hook Implementation
// ============================================

export function useResizeController(
  options: ResizeControllerOptions
): UseResizeControllerReturn {
  const {
    axis,
    min,
    max,
    onCommit,
    onPreview,
    handlePosition = "end",
    inverted = false,
  } = options;

  const id = useId();
  const { lock, unlock, isResizing: globalIsResizing } = useResizeManager();

  const containerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Track resize state locally (for visual feedback)
  const [isResizing, setIsResizing] = useState(false);
  const [previewSize, setPreviewSize] = useState<number | null>(null);

  // Refs for tracking during resize (avoids stale closures)
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);
  const currentSizeRef = useRef(0);

  // Cleanup drag listeners on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  /**
   * Start resize operation
   * @param event - Mouse event
   * @param currentSize - Current size of the element
   */
  const start = useCallback(
    (event: ReactMouseEvent, currentSize: number) => {
      // Prevent if another resize is active
      if (globalIsResizing) return;

      event.preventDefault();
      event.stopPropagation();

      // Store initial values
      startPosRef.current = axis === "x" ? event.clientX : event.clientY;
      startSizeRef.current = currentSize;
      currentSizeRef.current = currentSize;

      // Create session
      const session: ResizeSession = {
        id,
        startPos: startPosRef.current,
        startSize: currentSize,
        axis,
        startTime: Date.now(),
      };

      // Lock global resize
      lock(session);
      setIsResizing(true);
      setPreviewSize(currentSize);

      // Show ghost layer at current position
      if (ghostRef.current) {
        ghostRef.current.style.display = "block";
        if (axis === "x") {
          // Position the ghost line at the drag handle's current position
          ghostRef.current.style.left = `${event.clientX}px`;
        } else {
          ghostRef.current.style.top = `${event.clientY}px`;
        }
      }

      /**
       * Handle mouse move - ONLY operates on DOM, no React state updates
       * CRITICAL: No setState calls here to avoid React re-renders!
       */
      const handleMove = (moveEvent: globalThis.MouseEvent) => {
        const currentPos = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
        let delta = currentPos - startPosRef.current;

        // Handle inverted direction (e.g., right-side panel)
        if (inverted) {
          delta = -delta;
        }

        // Handle position affects delta direction
        if (handlePosition === "start") {
          delta = -delta;
        }

        // Calculate new size with constraints
        const newSize = Math.max(
          min,
          Math.min(max, startSizeRef.current + delta)
        );
        currentSizeRef.current = newSize;

        // Update ghost layer position (DOM only - no React render!)
        // For x-axis: position the ghost line at mouse position
        // For y-axis: position the ghost line at mouse position
        if (ghostRef.current) {
          if (axis === "x") {
            ghostRef.current.style.left = `${moveEvent.clientX}px`;
          } else {
            ghostRef.current.style.top = `${moveEvent.clientY}px`;
          }
        }

        // Optional preview callback (for CSS variables, not state)
        // This should ONLY update CSS variables or DOM, never React state
        onPreview?.(newSize);

        // NOTE: Removed setPreviewSize(newSize) - this was causing React re-renders!
        // previewSize is only set on start and cleared on end
      };

      /**
       * Handle mouse up - Commit to state
       */
      const handleEnd = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleEnd);
        dragCleanupRef.current = null;

        // Hide ghost layer
        if (ghostRef.current) {
          ghostRef.current.style.display = "none";
        }

        // Unlock global resize
        unlock();
        setIsResizing(false);
        setPreviewSize(null);

        // Commit final size to state (ONLY place where React state updates)
        onCommit(currentSizeRef.current);
      };

      // Attach global listeners
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleEnd);

      dragCleanupRef.current = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleEnd);
        if (ghostRef.current) {
          ghostRef.current.style.display = "none";
        }
        unlock();
        setIsResizing(false);
        setPreviewSize(null);
      };
    },
    [
      axis,
      min,
      max,
      onCommit,
      onPreview,
      handlePosition,
      inverted,
      globalIsResizing,
      lock,
      unlock,
      id,
    ]
  );

  return {
    containerRef,
    ghostRef,
    start,
    isResizing,
    previewSize,
  };
}

export default useResizeController;
