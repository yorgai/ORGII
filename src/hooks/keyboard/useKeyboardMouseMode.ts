/**
 * useKeyboardMouseMode Hook
 *
 * Centralized utility for managing keyboard vs mouse navigation mode.
 * Ensures only ONE item has hover effect at a time with keyboard priority over mouse.
 *
 * Features:
 * - Detects arrow key usage and switches to keyboard mode
 * - Detects actual mouse movement (not just synthetic events) and switches to mouse mode
 * - Configurable movement threshold
 * - Optional custom keys to trigger keyboard mode
 * - CSS data attribute for mode-based styling (always "true" or "false")
 *
 * Hover Priority:
 * - Keyboard mode: .selected class shows hover, :hover pseudo-class is suppressed
 * - Mouse mode: :hover pseudo-class shows hover, .selected class is suppressed
 *
 * @example
 * const { isKeyboardMode, handleMouseMove, dataKeyboardMode } = useKeyboardMouseMode();
 *
 * <div onMouseMove={handleMouseMove} data-keyboard-mode={dataKeyboardMode}>
 *   {items.map((item, index) => (
 *     <Item
 *       className={selectedIndex === index ? "selected" : ""}
 *       onMouseEnter={() => !isKeyboardMode && handleHover(index)}
 *     />
 *   ))}
 * </div>
 */
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ============================================
// Type Definitions
// ============================================

export interface UseKeyboardMouseModeOptions {
  /**
   * Movement threshold in pixels to switch from keyboard to mouse mode
   * @default 15
   */
  threshold?: number;

  /**
   * Custom keyboard keys that trigger keyboard mode
   * @default ["ArrowUp", "ArrowDown"]
   */
  triggerKeys?: string[];

  /**
   * Whether to enable the hook
   * @default true
   */
  enabled?: boolean;

  /**
   * Start in keyboard mode (pre-selects first item visually)
   * @default true
   */
  initialKeyboardMode?: boolean;
}

export interface UseKeyboardMouseModeReturn {
  /**
   * True when keyboard navigation is active (disable mouse hover)
   */
  isKeyboardMode: boolean;

  /**
   * Handler to attach to container's onMouseMove
   */
  handleMouseMove: (event: MouseEvent) => void;

  /**
   * Value to pass to data-keyboard-mode attribute for CSS styling
   * Always returns "true" or "false" string for reliable CSS selectors
   */
  dataKeyboardMode: "true" | "false";
}

// ============================================
// Constants
// ============================================

const DEFAULT_OPTIONS: Required<UseKeyboardMouseModeOptions> = {
  threshold: 15,
  triggerKeys: ["ArrowUp", "ArrowDown"],
  enabled: true,
  initialKeyboardMode: true,
};

// ============================================
// Hook Implementation
// ============================================

/**
 * Manages keyboard vs mouse navigation mode
 */
export function useKeyboardMouseMode(
  options: UseKeyboardMouseModeOptions = {}
): UseKeyboardMouseModeReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // State
  const [isKeyboardMode, setIsKeyboardMode] = useState(
    opts.initialKeyboardMode
  );
  const mousePosRef = useRef({ x: 0, y: 0 });

  // Listen for keyboard navigation - switch to keyboard mode
  useEffect(() => {
    if (!opts.enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (opts.triggerKeys.includes(event.key)) {
        setIsKeyboardMode(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [opts.enabled, opts.triggerKeys]);

  // Handle mouse move - switch back to mouse mode when mouse actually moves
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!opts.enabled || !isKeyboardMode) return;

      const dx = Math.abs(event.clientX - mousePosRef.current.x);
      const dy = Math.abs(event.clientY - mousePosRef.current.y);

      // Update position
      mousePosRef.current = { x: event.clientX, y: event.clientY };

      // If mouse moved significantly, switch back to mouse mode
      if (dx > opts.threshold || dy > opts.threshold) {
        setIsKeyboardMode(false);
      }
    },
    [opts.enabled, opts.threshold, isKeyboardMode]
  );

  return {
    isKeyboardMode,
    handleMouseMove,
    dataKeyboardMode: isKeyboardMode ? "true" : "false",
  };
}

export default useKeyboardMouseMode;
