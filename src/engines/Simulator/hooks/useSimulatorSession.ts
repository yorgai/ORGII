/**
 * useSimulatorSession
 *
 * Manages core session + event state for ActivitySimulator:
 * - Session identity and presence
 * - Thread/task selection and reset on session change
 * - Raw → corrected currentEvent (skips empty running file-tool events)
 * - Navigation to first event when thread selection changes
 * - Global data-source atom sync
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef } from "react";

import {
  effectiveSimulatorEventIdsAtom,
  navigateToFirstSimulatorEventAtom,
  simulatorEventPreviewByIdAtom,
  sortedSimulatorEventIdsAtom,
} from "@src/engines/SessionCore";
import type {
  SessionEvent,
  SimulatorEventPreview,
} from "@src/engines/SessionCore";
import {
  eventStoreVersionAtom,
  mainReplayCursorMsAtom,
} from "@src/engines/SessionCore";
import { eventIndexAtom } from "@src/engines/SessionCore/core/atoms/events";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { selectedExecutionThreadAtom } from "@src/store/ui/sessionPaginationAtom";
import { simulatorDataSourceAtom } from "@src/store/ui/simulatorAtom";

import { resolveNonEmptyEventFromIds } from "../utils/skipEmptyRunningEvent";
import { useSimulatorEvents } from "./useSimulatorEvents";

export interface UseSimulatorSessionReturn {
  sessionId: string;
  hasSession: boolean;
  eventIds: string[];
  eventById: Map<string, SessionEvent>;
  previewById: Record<string, SimulatorEventPreview>;
  specs: ReturnType<typeof useSimulatorEvents>["specs"];
  filteredEvents: SessionEvent[];
  currentEvent: SessionEvent | null;
  currentEventIndex: number;
  eventStoreVersion: number;
  mainCursorMs: number | null;
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  executionThreads: { threadId: string; eventCount: number }[];
  executionThreadCount: number;
}

export function useSimulatorSession(): UseSimulatorSessionReturn {
  const { sessionId: resolvedSessionId } = useSessionId();
  const sessionId = resolvedSessionId || "";
  const hasSession = Boolean(resolvedSessionId);

  const {
    eventIds,
    specs,
    currentEvent: rawCurrentEvent,
    setCurrentEventById,
  } = useSimulatorEvents();

  const effectiveEventIds = useAtomValue(effectiveSimulatorEventIdsAtom);
  const sortedSimulatorEventIds = useAtomValue(sortedSimulatorEventIdsAtom);
  const previewById = useAtomValue(simulatorEventPreviewByIdAtom);
  const eventById = useAtomValue(eventIndexAtom);
  const eventStoreVersion = useAtomValue(eventStoreVersionAtom);
  const mainCursorMs = useAtomValue(mainReplayCursorMsAtom);
  const navigateToFirstSimulatorEvent = useSetAtom(
    navigateToFirstSimulatorEventAtom
  );

  const [selectedTaskId, setSelectedTaskId] = useAtom(
    selectedExecutionThreadAtom
  );

  const setGlobalDataSource = useSetAtom(simulatorDataSourceAtom);
  useEffect(() => {
    setGlobalDataSource("real");
  }, [setGlobalDataSource]);

  // Reset thread selection when session changes
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId;
      if (selectedTaskId !== null) {
        setSelectedTaskId(null);
      }
    }
  }, [sessionId, selectedTaskId, setSelectedTaskId]);

  const filteredEvents = useMemo(() => {
    if (!selectedTaskId) return [];
    return effectiveEventIds
      .map((eventId) => eventById.get(eventId))
      .filter((event): event is SessionEvent => Boolean(event));
  }, [selectedTaskId, effectiveEventIds, eventById]);

  // Navigate to first event when thread selection changes
  const prevSelectedTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedTaskId === prevSelectedTaskIdRef.current) return;
    prevSelectedTaskIdRef.current = selectedTaskId;
    if (selectedTaskId && effectiveEventIds.length > 0) {
      navigateToFirstSimulatorEvent();
    }
  }, [selectedTaskId, effectiveEventIds.length, navigateToFirstSimulatorEvent]);

  const currentEvent = useMemo(
    () => resolveNonEmptyEventFromIds(rawCurrentEvent, eventIds, eventById),
    [rawCurrentEvent, eventIds, eventById]
  );

  // Sync corrected event back so chat panel highlight follows
  useEffect(() => {
    if (
      currentEvent &&
      rawCurrentEvent &&
      currentEvent.id !== rawCurrentEvent.id
    ) {
      setCurrentEventById(currentEvent.chunk_id);
    }
  }, [currentEvent, rawCurrentEvent, setCurrentEventById]);

  const currentEventIndex = useMemo(() => {
    if (!currentEvent) return -1;
    return eventIds.indexOf(currentEvent.id);
  }, [currentEvent, eventIds]);

  // Collect named execution threads (exclude default / uuid-prefixed)
  const executionThreads = useMemo(() => {
    const threadMap = new Map<
      string,
      { threadId: string; eventCount: number }
    >();
    for (const eventId of sortedSimulatorEventIds) {
      const threadId = String(previewById[eventId]?.threadId ?? "").trim();
      if (
        threadId &&
        threadId !== "default" &&
        !/^[0-9a-f]{8}[-\s]/i.test(threadId)
      ) {
        const existing = threadMap.get(threadId);
        if (existing) {
          existing.eventCount++;
        } else {
          threadMap.set(threadId, { threadId, eventCount: 1 });
        }
      }
    }
    return Array.from(threadMap.values()).sort(
      (a, b) => b.eventCount - a.eventCount
    );
  }, [sortedSimulatorEventIds, previewById]);

  return {
    sessionId,
    hasSession,
    eventIds,
    eventById,
    previewById,
    specs,
    filteredEvents,
    currentEvent,
    currentEventIndex,
    eventStoreVersion,
    mainCursorMs,
    selectedTaskId,
    setSelectedTaskId,
    executionThreads,
    executionThreadCount: executionThreads.length,
  };
}
