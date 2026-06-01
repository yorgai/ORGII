/**
 * useCalendarGrid Hook
 *
 * Calculates grid structure for calendar views.
 */
import { useMemo } from "react";

import {
  getMonthCalendarDays,
  getStartOfDay,
  getTimeSlots,
  getWeekDays,
} from "../config";
import {
  type CalendarConfig,
  type CalendarViewMode,
  DEFAULT_CALENDAR_CONFIG,
} from "../types";

// ============================================
// Types
// ============================================

export interface UseCalendarGridOptions {
  /** Current view mode */
  viewMode: CalendarViewMode;
  /** Current date being viewed */
  currentDate: Date;
  /** Calendar configuration */
  config?: Partial<CalendarConfig>;
}

export interface UseCalendarGridReturn {
  /** Days to render in the grid */
  days: Date[];
  /** Time slots for day/week view (e.g., ["00:00", "01:00", ...]) */
  timeSlots: string[];
  /** Number of columns in the grid */
  columns: number;
  /** Number of rows in the grid */
  rows: number;
  /** Config values being used */
  config: CalendarConfig;
}

// ============================================
// Hook
// ============================================

export function useCalendarGrid(
  options: UseCalendarGridOptions
): UseCalendarGridReturn {
  const { viewMode, currentDate, config: configOverrides } = options;

  const config: CalendarConfig = useMemo(
    () => ({
      ...DEFAULT_CALENDAR_CONFIG,
      ...configOverrides,
    }),
    [configOverrides]
  );

  const days = useMemo((): Date[] => {
    switch (viewMode) {
      case "day":
        return [getStartOfDay(currentDate)];
      case "week":
        return getWeekDays(currentDate, config.weekStartsOn);
      case "month":
        return getMonthCalendarDays(currentDate, config.weekStartsOn);
      default:
        return [];
    }
  }, [viewMode, currentDate, config.weekStartsOn]);

  const timeSlots = useMemo((): string[] => {
    if (viewMode === "month") {
      return []; // Month view doesn't use time slots
    }
    return getTimeSlots(
      config.dayStartHour,
      config.dayEndHour,
      config.slotDuration
    );
  }, [viewMode, config.dayStartHour, config.dayEndHour, config.slotDuration]);

  const columns = useMemo((): number => {
    switch (viewMode) {
      case "day":
        return 1;
      case "week":
        return config.showWeekends ? 7 : 5;
      case "month":
        return 7;
      default:
        return 7;
    }
  }, [viewMode, config.showWeekends]);

  const rows = useMemo((): number => {
    switch (viewMode) {
      case "day":
      case "week":
        return timeSlots.length;
      case "month":
        return Math.ceil(days.length / 7);
      default:
        return 0;
    }
  }, [viewMode, timeSlots.length, days.length]);

  return {
    days,
    timeSlots,
    columns,
    rows,
    config,
  };
}
