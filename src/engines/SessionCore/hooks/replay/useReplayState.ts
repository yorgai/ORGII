/**
 * useReplayState Hook
 *
 * Provides replay state and controls for session playback.
 * Uses session store atoms directly.
 *
 * MIGRATION COMPLETE:
 * - Returns SessionEvent directly (no conversion!)
 * - Use currentEventAtom from session store
 */
import dayjs from "dayjs";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";

import type { WsSpec } from "@src/types/session/steps";

import {
  currentEventAtom,
  currentEventIdAtom,
  replayBarValueAtom as sessionReplayBarValueAtom,
  replayTimeRangeAtom as sessionReplayTimeRangeAtom,
  specsAtom,
} from "../../core/atoms";
import type { SessionEvent, SessionSpec } from "../../core/types";

// ============================================
// Types (matching ReplayContextType)
// ============================================

export interface WpTimeRange {
  start: string;
  end: string;
}

export interface UseReplayStateReturn {
  replayTimeRange: WpTimeRange;
  setReplayTimeRange: (range: WpTimeRange) => void;
  replayCurTime: dayjs.Dayjs;
  setReplayCurTime: Dispatch<SetStateAction<dayjs.Dayjs>>;
  currentEvent: SessionEvent | null;
  setCurrentEvent: (eventId: string | null) => void;
  replayBarValue: number | number[];
  setReplayBarValue: (value: number | number[]) => void;
  replaySpecList: WsSpec[];
  setReplaySpecList: (specs: WsSpec[]) => void;
}

// ============================================
// Hook Implementation
// ============================================

export function useReplayState(): UseReplayStateReturn {
  // Session store atoms
  const [timeRange, setTimeRange] = useAtom(sessionReplayTimeRangeAtom);
  const [barValue, setBarValue] = useAtom(sessionReplayBarValueAtom);
  const setCurrentEventId = useSetAtom(currentEventIdAtom);

  // Read current event directly from session store (no conversion!)
  const currentEvent = useAtomValue(currentEventAtom);

  // Read specs and convert inline
  const sessionSpecs = useAtomValue(specsAtom);
  const specList = useMemo(
    () =>
      sessionSpecs.map((spec) => ({
        spec_id: spec.specId,
        session_id: spec.sessionId,
        spec: spec.spec,
        content: spec.content,
        created_time: spec.createdTime,
        status: spec.status,
        step_id: spec.stepId,
      })),
    [sessionSpecs]
  );

  const setSpecs = useSetAtom(specsAtom);

  // Local state for things that don't need global sharing
  const [replayCurTime, setReplayCurTime] = useState<dayjs.Dayjs>(dayjs());

  // Wrapped setters for API compatibility

  const setCurrentEvent = useCallback(
    (eventId: string | null) => {
      setCurrentEventId(eventId);
    },
    [setCurrentEventId]
  );

  const setReplayBarValue = useCallback(
    (value: number | number[]) => {
      const numValue = Array.isArray(value) ? value[0] : value;
      setBarValue(numValue);
    },
    [setBarValue]
  );

  const setReplayTimeRange = useCallback(
    (range: WpTimeRange) => {
      setTimeRange({ start: range.start, end: range.end });
    },
    [setTimeRange]
  );

  const setReplaySpecList = useCallback(
    (specs: WsSpec[]) => {
      // Convert WsSpec[] to SessionSpec[]
      const sessionSpecs: SessionSpec[] = specs.map((spec) => ({
        specId: spec.spec_id,
        sessionId: spec.session_id,
        spec: spec.spec,
        content: spec.content,
        createdTime: spec.created_time,
        status: spec.status,
        stepId: spec.step_id,
      }));
      setSpecs(sessionSpecs);
    },
    [setSpecs]
  );

  // Convert session store time range to WpTimeRange format
  const replayTimeRange: WpTimeRange = useMemo(
    () => ({
      start: timeRange.start,
      end: timeRange.end,
    }),
    [timeRange]
  );

  return {
    replayTimeRange,
    setReplayTimeRange,
    replayCurTime,
    setReplayCurTime,
    currentEvent,
    setCurrentEvent,
    replayBarValue: barValue,
    setReplayBarValue,
    replaySpecList: specList,
    setReplaySpecList,
  };
}

// ============================================
// Selector Hooks
// ============================================

export function useReplayTime() {
  const {
    replayTimeRange,
    setReplayTimeRange,
    replayCurTime,
    setReplayCurTime,
  } = useReplayState();
  return {
    replayTimeRange,
    setReplayTimeRange,
    replayCurTime,
    setReplayCurTime,
  };
}

export function useReplayBarState() {
  const { replayBarValue, setReplayBarValue } = useReplayState();
  return { replayBarValue, setReplayBarValue };
}
