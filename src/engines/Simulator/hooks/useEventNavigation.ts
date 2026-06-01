/**
 * useEventNavigation Hook
 *
 * Provides navigation controls for simulator events.
 * Supports jumping to start/end and next/previous events.
 *
 * Features:
 * - Go to first/last event
 * - Navigate to next/previous event
 * - Set event by ID or index
 * - Sync with replay bar position
 */
import dayjs from "dayjs";
import { useCallback } from "react";

import { REPLAY_CONFIG } from "@src/config/workspace/replayConfig";
import type { SessionEvent } from "@src/engines/SessionCore";

import { TimeRangeInfo } from "./types";

// ============================================
// Types
// ============================================

export interface UseEventNavigationOptions {
  /** Effective simulator event IDs in navigation order */
  eventIds: string[];
  /** Full events by ID for O(1) hydration of the active event */
  eventById: Map<string, SessionEvent>;
  /** Current event */
  currentEvent: SessionEvent | null;
  /** Current event index */
  currentEventIndex: number;
  /** Time range info for replay bar sync */
  timeRangeInfo: TimeRangeInfo;
  /** Set current event in context */
  setContextCurEvent: (event: SessionEvent | null) => void;
  /** Set replay bar value */
  setReplayBarValue: (value: number) => void;
  /** Callback when event changes */
  onEventChange?: (event: SessionEvent | null) => void;
}

export interface UseEventNavigationReturn {
  /** Set current event by ID */
  setCurrentEventById: (eventId: string | null) => void;
  /** Set current event by index */
  setCurrentEventByIndex: (index: number) => void;
  /** Set replay value (0 to MAX_VALUE) */
  setReplayValue: (value: number) => void;
  /** Go to first event */
  goToStart: () => void;
  /** Go to last event */
  goToEnd: () => void;
  /** Go to next event */
  goToNext: () => void;
  /** Go to previous event */
  goToPrevious: () => void;
}

// ============================================
// Hook Implementation
// ============================================

export function useEventNavigation(
  options: UseEventNavigationOptions
): UseEventNavigationReturn {
  const {
    eventIds,
    eventById,
    currentEventIndex,
    timeRangeInfo,
    setContextCurEvent,
    setReplayBarValue,
    onEventChange,
  } = options;

  // Set replay value (updates context)
  const setReplayValue = useCallback(
    (value: number) => {
      const clampedValue = Math.max(
        0,
        Math.min(REPLAY_CONFIG.MAX_VALUE, value)
      );
      setReplayBarValue(clampedValue);
    },
    [setReplayBarValue]
  );

  // Set current event by ID - uses O(1) index lookup
  const setCurrentEventById = useCallback(
    (eventId: string | null) => {
      if (eventId) {
        const event = eventById.get(eventId);
        if (event) {
          setContextCurEvent(event);

          // Update replay bar to match event time
          if (timeRangeInfo.isValid && timeRangeInfo.timeRangeMs > 0) {
            const eventMs = dayjs(event.createdAt).valueOf();
            const value =
              ((eventMs - timeRangeInfo.startMs) / timeRangeInfo.timeRangeMs) *
              REPLAY_CONFIG.MAX_VALUE;
            setReplayBarValue(
              Math.max(0, Math.min(REPLAY_CONFIG.MAX_VALUE, value))
            );
          }
        }
      } else {
        setContextCurEvent(null);
      }

      onEventChange?.(eventId ? eventById.get(eventId) || null : null);
    },
    [
      eventById,
      setContextCurEvent,
      timeRangeInfo,
      setReplayBarValue,
      onEventChange,
    ]
  );

  // Set current event by index
  const setCurrentEventByIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < eventIds.length) {
        setCurrentEventById(eventIds[index]);
      } else {
        setCurrentEventById(null);
      }
    },
    [eventIds, setCurrentEventById]
  );

  // Navigation controls
  const goToStart = useCallback(() => {
    setReplayValue(0);
  }, [setReplayValue]);

  const goToEnd = useCallback(() => {
    setReplayValue(REPLAY_CONFIG.MAX_VALUE);
  }, [setReplayValue]);

  const goToNext = useCallback(() => {
    if (currentEventIndex < eventIds.length - 1) {
      setCurrentEventByIndex(currentEventIndex + 1);
    }
  }, [currentEventIndex, eventIds.length, setCurrentEventByIndex]);

  const goToPrevious = useCallback(() => {
    if (currentEventIndex > 0) {
      setCurrentEventByIndex(currentEventIndex - 1);
    }
  }, [currentEventIndex, setCurrentEventByIndex]);

  return {
    setCurrentEventById,
    setCurrentEventByIndex,
    setReplayValue,
    goToStart,
    goToEnd,
    goToNext,
    goToPrevious,
  };
}

export default useEventNavigation;
