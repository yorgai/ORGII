/**
 * useGanttZoom Hook
 *
 * Manages zoom level for the Gantt chart.
 */
import { useCallback, useState } from "react";

export type ZoomLevel = 50 | 75 | 100 | 125 | 150 | 200;

export interface UseGanttZoomOptions {
  defaultZoom?: ZoomLevel;
  onZoomChange?: (zoom: ZoomLevel) => void;
}

export interface UseGanttZoomReturn {
  zoomLevel: ZoomLevel;
  setZoomLevel: (level: ZoomLevel) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  getScaledColumnWidth: (baseWidth: number) => number;
}

const ZOOM_LEVELS: ZoomLevel[] = [50, 75, 100, 125, 150, 200];

export function useGanttZoom({
  defaultZoom = 100,
  onZoomChange,
}: UseGanttZoomOptions = {}): UseGanttZoomReturn {
  const [zoomLevel, setZoomLevelInternal] = useState<ZoomLevel>(defaultZoom);

  const setZoomLevel = useCallback(
    (level: ZoomLevel) => {
      setZoomLevelInternal(level);
      onZoomChange?.(level);
    },
    [onZoomChange]
  );

  const zoomIn = useCallback(() => {
    const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel);
    if (currentIndex < ZOOM_LEVELS.length - 1) {
      setZoomLevel(ZOOM_LEVELS[currentIndex + 1]);
    }
  }, [zoomLevel, setZoomLevel]);

  const zoomOut = useCallback(() => {
    const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel);
    if (currentIndex > 0) {
      setZoomLevel(ZOOM_LEVELS[currentIndex - 1]);
    }
  }, [zoomLevel, setZoomLevel]);

  const resetZoom = useCallback(() => {
    setZoomLevel(100);
  }, [setZoomLevel]);

  const getScaledColumnWidth = useCallback(
    (baseWidth: number): number => {
      return Math.round(baseWidth * (zoomLevel / 100));
    },
    [zoomLevel]
  );

  return {
    zoomLevel,
    setZoomLevel,
    zoomIn,
    zoomOut,
    resetZoom,
    getScaledColumnWidth,
  };
}
