/**
 * useGanttNavigation Hook
 *
 * Handles time navigation: prev/next periods and go to today.
 */
import { useCallback } from "react";

import { addPeriods, getStartOfPeriod } from "../config";
import type { GanttTimeScale } from "../types";

export interface UseGanttNavigationOptions {
  timeScale: GanttTimeScale;
  setViewStart: (date: Date | ((prev: Date) => Date)) => void;
}

export function useGanttNavigation({
  timeScale,
  setViewStart,
}: UseGanttNavigationOptions) {
  const handleGoToToday = useCallback(() => {
    const today = getStartOfPeriod(new Date(), timeScale);
    setViewStart(addPeriods(today, -2, timeScale));
  }, [timeScale, setViewStart]);

  const handleNavigate = useCallback(
    (direction: "prev" | "next") => {
      const offset = direction === "prev" ? -4 : 4;
      setViewStart((prev) => addPeriods(prev, offset, timeScale));
    },
    [timeScale, setViewStart]
  );

  return {
    handleGoToToday,
    handleNavigate,
  };
}
