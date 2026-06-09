/**
 * usePanelResize Hook
 *
 * Reusable resize logic for panels (eliminates duplicate code)
 */
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface UsePanelResizeOptions {
  /** Minimum size (width or height) */
  minSize: number;
  /** Maximum size (width or height) */
  maxSize: number;
  /** Initial size */
  initialSize: number;
  /** Resize direction */
  direction: "horizontal" | "vertical";
  /** Callback when size changes */
  onSizeChange: (size: number) => void;
}

export interface UsePanelResizeReturn {
  /** Current size */
  size: number;
  /** Whether currently resizing */
  isResizing: boolean;
  /** Mouse down handler for resize handle */
  handleMouseDown: (event: ReactMouseEvent) => void;
  /** Ref for the panel element */
  panelRef: RefObject<HTMLDivElement | null>;
}

export function usePanelResize({
  minSize,
  maxSize,
  initialSize,
  direction,
  onSizeChange,
}: UsePanelResizeOptions): UsePanelResizeReturn {
  const [size, setSize] = useState(initialSize);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Cache container rect at drag-start so mousemove never touches parentElement.
  const containerRectRef = useRef<DOMRect | null>(null);

  const handleMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    containerRectRef.current =
      panelRef.current?.parentElement?.getBoundingClientRect() ?? null;
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!isResizing) return;

      const containerRect = containerRectRef.current;
      if (!containerRect) return;

      let newSize: number;
      if (direction === "vertical") {
        newSize = containerRect.bottom - event.clientY;
      } else {
        newSize = containerRect.right - event.clientX;
      }

      const clampedSize = Math.min(maxSize, Math.max(minSize, newSize));
      setSize(clampedSize);
      onSizeChange(clampedSize);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      containerRectRef.current = null;
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor =
        direction === "vertical" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, direction, minSize, maxSize, onSizeChange]);

  return {
    size,
    isResizing,
    handleMouseDown,
    panelRef,
  };
}
