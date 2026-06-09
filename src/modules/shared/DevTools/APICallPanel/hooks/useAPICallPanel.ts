// ============================================
// useAPICallPanel Hook
// ============================================
/**
 * useAPICallPanel Hook
 *
 * Handles business logic for the Panel API Call component:
 * - Panel resizing
 * - Operation expansion
 *
 * @example
 * const { height, expandedCall, ... } = useAPICallPanel();
 */
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ============================================
// Type Definitions
// ============================================

export interface UseAPICallPanelReturn {
  height: number;
  isResizing: boolean;
  expandedCall: string | null;
  listRef: RefObject<HTMLDivElement | null>;
  handleResizeStart: (event: ReactMouseEvent) => void;
  toggleExpand: (callId: string) => void;
  setExpandedCall: (callId: string | null) => void;
}

// ============================================
// Constants
// ============================================

const MIN_HEIGHT = 180;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 320;

// ============================================
// Hook Implementation
// ============================================

export function useAPICallPanel(): UseAPICallPanelReturn {
  // State
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  // Refs
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);
  const listRef = useRef<HTMLDivElement>(null);

  // ============================================
  // Methods
  // ============================================

  /**
   * Handle resize start
   */
  const handleResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      setIsResizing(true);
      resizeStartY.current = event.clientY;
      resizeStartHeight.current = height;
    },
    [height]
  );

  /**
   * Toggle expand/collapse for operation
   */
  const toggleExpand = useCallback((callId: string) => {
    setExpandedCall((prev) => (prev === callId ? null : callId));
  }, []);

  const setExpanded = useCallback((callId: string | null) => {
    setExpandedCall(callId);
  }, []);

  // ============================================
  // Effects
  // ============================================

  // Handle resize
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const deltaY = resizeStartY.current - event.clientY;
      const newHeight = Math.max(
        MIN_HEIGHT,
        Math.min(MAX_HEIGHT, resizeStartHeight.current + deltaY)
      );
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  return {
    height,
    isResizing,
    expandedCall,
    listRef,
    handleResizeStart,
    toggleExpand,
    setExpandedCall: setExpanded,
  };
}
