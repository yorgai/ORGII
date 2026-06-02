import { useCallback, useEffect, useState } from "react";
import type React from "react";

interface PortalPosition {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

interface UsePortalPositionResult {
  position: PortalPosition;
  isPositioned: boolean;
}

/**
 * Measures the bounding rect of `containerRef` and keeps it in sync when the
 * container's parent element resizes. Re-measures whenever `visible` or
 * `containerRef` changes.
 */
export function usePortalPosition(
  visible: boolean,
  containerRef: React.RefObject<HTMLElement | null>
): UsePortalPositionResult {
  const [position, setPosition] = useState<PortalPosition>({
    top: 0,
    bottom: 0,
    left: 0,
    width: 0,
  });
  const [isPositioned, setIsPositioned] = useState(false);

  const measure = useCallback(() => {
    if (visible && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
      });
      setIsPositioned(true);
    } else {
      setIsPositioned(false);
    }
  }, [visible, containerRef]);

  // Initial measurement (runs once on mount, before paint)
  useEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-measure when visibility or ref changes
  useEffect(() => {
    measure();
  }, [measure]);

  // Re-measure when the container's parent resizes (e.g. panel drag)
  useEffect(() => {
    if (!visible) return;
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [visible, containerRef, measure]);

  return { position, isPositioned };
}
