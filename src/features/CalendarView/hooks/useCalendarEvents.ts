/**
 * useCalendarEvents Hook
 *
 * Processes and positions events for rendering.
 */
import { useCallback, useMemo } from "react";

import {
  eventSpansDate,
  getEventTimePosition,
  getStartOfDay,
  parseDate,
} from "../config";
import type {
  CalendarEvent,
  CalendarViewMode,
  PositionedEvent,
} from "../types";

// ============================================
// Types
// ============================================

export interface UseCalendarEventsOptions {
  /** Array of events */
  events: CalendarEvent[];
  /** Current view mode */
  viewMode: CalendarViewMode;
  /** Day start hour for positioning (0-23) */
  dayStartHour?: number;
  /** Day end hour for positioning (0-24) */
  dayEndHour?: number;
}

export interface UseCalendarEventsReturn {
  /** Get events for a specific date */
  eventsForDay: (date: Date) => CalendarEvent[];
  /** Get positioned events for day/week view (with overlap handling) */
  positionedEventsForDay: (date: Date) => PositionedEvent[];
  /** Get all-day events for a specific date */
  allDayEventsForDay: (date: Date) => CalendarEvent[];
}

// ============================================
// Helper Functions
// ============================================

const MIN_EVENT_HEIGHT_PERCENT = 2;

interface EventColumnPosition {
  column: number;
  totalColumns: number;
}

interface EventInterval {
  event: CalendarEvent;
  startMs: number;
  endMs: number;
}

function eventsOverlap(eventA: EventInterval, eventB: EventInterval): boolean {
  return eventA.startMs < eventB.endMs && eventB.startMs < eventA.endMs;
}

function assignColumnsForGroup(
  group: EventInterval[],
  result: Map<string, EventColumnPosition>
): void {
  const columnEndTimes: number[] = [];
  const assignedPositions = new Map<string, number>();

  for (const interval of group) {
    const availableColumn = columnEndTimes.findIndex(
      (endMs) => endMs <= interval.startMs
    );
    const column =
      availableColumn === -1 ? columnEndTimes.length : availableColumn;
    columnEndTimes[column] = interval.endMs;
    assignedPositions.set(interval.event.id, column);
  }

  const totalColumns = Math.max(1, columnEndTimes.length);
  for (const interval of group) {
    result.set(interval.event.id, {
      column: assignedPositions.get(interval.event.id) ?? 0,
      totalColumns,
    });
  }
}

function calculateEventColumns(
  events: CalendarEvent[],
  dayStartHour: number,
  dayEndHour: number
): Map<string, EventColumnPosition> {
  const result = new Map<string, EventColumnPosition>();
  if (events.length === 0) return result;

  const dayDurationMs = (dayEndHour - dayStartHour) * 60 * 60 * 1000;
  const minVisualDurationMs = dayDurationMs * (MIN_EVENT_HEIGHT_PERCENT / 100);

  const sortedIntervals = events
    .map((event) => {
      const startMs = parseDate(event.startDate).getTime();
      const endMs = parseDate(event.endDate).getTime();
      return {
        event,
        startMs,
        endMs: Math.max(endMs, startMs + minVisualDurationMs),
      };
    })
    .sort((eventA, eventB) => {
      if (eventA.startMs !== eventB.startMs) {
        return eventA.startMs - eventB.startMs;
      }
      return eventB.endMs - eventA.endMs;
    });

  let currentGroup: EventInterval[] = [];

  for (const interval of sortedIntervals) {
    const overlapsCurrentGroup = currentGroup.some((groupInterval) =>
      eventsOverlap(interval, groupInterval)
    );
    if (currentGroup.length > 0 && !overlapsCurrentGroup) {
      assignColumnsForGroup(currentGroup, result);
      currentGroup = [];
    }

    currentGroup.push(interval);
  }

  if (currentGroup.length > 0) {
    assignColumnsForGroup(currentGroup, result);
  }

  return result;
}

// ============================================
// Hook
// ============================================

export function useCalendarEvents(
  options: UseCalendarEventsOptions
): UseCalendarEventsReturn {
  const { events, dayStartHour = 0, dayEndHour = 24 } = options;

  // Parse dates once
  const parsedEvents = useMemo(() => {
    return events.map((event) => ({
      ...event,
      _startDate: parseDate(event.startDate),
      _endDate: parseDate(event.endDate),
    }));
  }, [events]);

  const eventsForDay = useCallback(
    (date: Date): CalendarEvent[] => {
      const dayStart = getStartOfDay(date);
      return parsedEvents.filter((event) =>
        eventSpansDate(event._startDate, event._endDate, dayStart)
      );
    },
    [parsedEvents]
  );

  const allDayEventsForDay = useCallback(
    (date: Date): CalendarEvent[] => {
      const dayStart = getStartOfDay(date);
      return parsedEvents.filter(
        (event) =>
          event.allDay &&
          eventSpansDate(event._startDate, event._endDate, dayStart)
      );
    },
    [parsedEvents]
  );

  const positionedEventsForDay = useCallback(
    (date: Date): PositionedEvent[] => {
      const dayStart = getStartOfDay(date);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      const dayEventSegments = parsedEvents
        .filter(
          (event) =>
            !event.allDay &&
            eventSpansDate(event._startDate, event._endDate, dayStart)
        )
        .map((event) => ({
          event,
          segmentStart:
            event._startDate.getTime() < dayStart.getTime()
              ? dayStart
              : event._startDate,
          segmentEnd:
            event._endDate.getTime() > dayEnd.getTime()
              ? dayEnd
              : event._endDate,
        }));

      if (dayEventSegments.length === 0) return [];

      const columns = calculateEventColumns(
        dayEventSegments.map(({ event, segmentStart, segmentEnd }) => ({
          ...event,
          startDate: segmentStart,
          endDate: segmentEnd,
        })),
        dayStartHour,
        dayEndHour
      );

      return dayEventSegments.map(({ event, segmentStart, segmentEnd }) => {
        const position = columns.get(event.id) || {
          column: 0,
          totalColumns: 1,
        };

        // Calculate vertical position
        const top = getEventTimePosition(
          segmentStart,
          dayStartHour,
          dayEndHour
        );
        const bottom = getEventTimePosition(
          segmentEnd,
          dayStartHour,
          dayEndHour
        );
        const height = Math.max(bottom - top, MIN_EVENT_HEIGHT_PERCENT);

        return {
          ...event,
          column: position.column,
          totalColumns: position.totalColumns,
          top,
          height,
        };
      });
    },
    [parsedEvents, dayStartHour, dayEndHour]
  );

  return {
    eventsForDay,
    positionedEventsForDay,
    allDayEventsForDay,
  };
}
