/**
 * useCalendarNavigation Hook
 *
 * Manages calendar navigation state (prev/next/today).
 */
import { useCallback, useState } from "react";

import { addDays, addMonths, addWeeks, getStartOfDay } from "../config";
import type { CalendarViewMode } from "../types";

// ============================================
// Types
// ============================================

export interface UseCalendarNavigationOptions {
  /** Initial date to display */
  initialDate?: Date;
  /** Week starts on: 0 = Sunday, 1 = Monday */
  weekStartsOn?: 0 | 1;
}

export interface UseCalendarNavigationReturn {
  /** Current date being viewed */
  currentDate: Date;
  /** Navigate to previous period (based on view mode) */
  goToPrevious: (viewMode: CalendarViewMode) => void;
  /** Navigate to next period (based on view mode) */
  goToNext: (viewMode: CalendarViewMode) => void;
  /** Navigate to today */
  goToToday: () => void;
  /** Navigate to specific date */
  goToDate: (date: Date) => void;
}

// ============================================
// Hook
// ============================================

export function useCalendarNavigation(
  options: UseCalendarNavigationOptions = {}
): UseCalendarNavigationReturn {
  const { initialDate = new Date() } = options;

  const [currentDate, setCurrentDate] = useState<Date>(() =>
    getStartOfDay(initialDate)
  );

  const goToPrevious = useCallback((viewMode: CalendarViewMode) => {
    setCurrentDate((prev) => {
      switch (viewMode) {
        case "day":
          return addDays(prev, -1);
        case "week":
          return addWeeks(prev, -1);
        case "month":
          return addMonths(prev, -1);
        default:
          return prev;
      }
    });
  }, []);

  const goToNext = useCallback((viewMode: CalendarViewMode) => {
    setCurrentDate((prev) => {
      switch (viewMode) {
        case "day":
          return addDays(prev, 1);
        case "week":
          return addWeeks(prev, 1);
        case "month":
          return addMonths(prev, 1);
        default:
          return prev;
      }
    });
  }, []);

  const goToToday = useCallback(() => {
    setCurrentDate(getStartOfDay(new Date()));
  }, []);

  const goToDate = useCallback((date: Date) => {
    setCurrentDate(getStartOfDay(date));
  }, []);

  return {
    currentDate,
    goToPrevious,
    goToNext,
    goToToday,
    goToDate,
  };
}
