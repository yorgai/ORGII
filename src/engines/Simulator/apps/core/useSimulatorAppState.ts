/**
 * useSimulatorAppState Hook
 *
 * Base hook for all simulator apps. Provides:
 * - Replay-aware event filtering
 * - State derivation from events
 * - Selection state management
 * - Jump-to-event functionality
 *
 * ARCHITECTURE: Uses SessionEvent from session store (SINGLE SOURCE OF TRUTH)
 * Each simulator app (IDE, Messages, Notes) uses this hook
 * with its own configuration to get consistent behavior.
 */
import { type Atom, atom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo, useRef, useState } from "react";

import { REPLAY_CONFIG } from "@src/config/workspace/replayConfig";
import {
  currentEventAtom,
  navigateToEventAtom,
  replayBarValueAtom,
  replayModeAtom,
} from "@src/engines/SessionCore/core/atoms";
import { eventIndexAtom } from "@src/engines/SessionCore/core/atoms/events";
import type {
  SessionEvent,
  SimulatorEventPreview,
} from "@src/engines/SessionCore/core/types";
import {
  simulatorEventPreviewByIdAtom,
  sortedSimulatorEventIdsAtom,
} from "@src/engines/SessionCore/derived/simulatorEvents";
import { getAppTypeForTool } from "@src/engines/SessionCore/rendering/registry";
import { AppType } from "@src/engines/Simulator/types/appTypes";

import { hydrateFullEventWindow } from "./fullEventHydrationRegistry";
import type {
  SimulatorAppBaseState,
  UseSimulatorAppStateOptions,
  UseSimulatorAppStateReturn,
} from "./types";

// ============================================
// Helpers
// ============================================

/**
 * Filter events that match the app's categories and are up to the current point.
 * Uses a pre-built id→index Map for O(1) lookup instead of O(n) findIndex.
 *
 * When `skip` is true the `matchesEvent` predicate is not applied — the caller
 * guarantees the event source is already filtered (e.g. Rust `messagesEvents`).
 */
const MAX_APP_HYDRATION_WINDOW = 320;
const EMPTY_EVENTS_ATOM = atom<SessionEvent[]>([]);

function matchesPreviewForApp(
  preview: SimulatorEventPreview,
  appType: AppType,
  matchesEvent: (eventFunction: string) => boolean
): boolean {
  if (matchesEvent(preview.functionName)) return true;
  const mappedAppType = getAppTypeForTool(preview.functionName);
  return (
    appType === AppType.CODE_EDITOR && mappedAppType === AppType.CODE_EDITOR
  );
}

function filterEventIdsForApp(
  allEventIds: string[],
  currentEventId: string | null,
  previewById: Record<string, SimulatorEventPreview>,
  appType: AppType,
  matchesEvent: (eventFunction: string) => boolean,
  skip: boolean
): string[] {
  if (!currentEventId) return [];

  const currentIndex = allEventIds.indexOf(currentEventId);
  const endIndex = currentIndex === -1 ? allEventIds.length : currentIndex + 1;
  const startIndex = Math.max(0, endIndex - MAX_APP_HYDRATION_WINDOW);
  const windowedIds = allEventIds.slice(startIndex, endIndex);

  if (skip) return windowedIds;

  return windowedIds.filter((eventId) => {
    const preview = previewById[eventId];
    return preview
      ? matchesPreviewForApp(preview, appType, matchesEvent)
      : false;
  });
}

function filterLegacyEventsForApp(
  allEvents: SessionEvent[],
  currentEventId: string | null,
  matchesEvent: (eventFunction: string) => boolean,
  skip: boolean
): SessionEvent[] {
  if (!currentEventId) return [];

  const currentIndex = allEvents.findIndex(
    (event) => event.id === currentEventId
  );
  const endIndex = currentIndex === -1 ? allEvents.length : currentIndex + 1;
  const startIndex = Math.max(0, endIndex - MAX_APP_HYDRATION_WINDOW);
  const eventsUpToCurrent = allEvents.slice(startIndex, endIndex);

  return skip
    ? eventsUpToCurrent
    : eventsUpToCurrent.filter((event) => matchesEvent(event.functionName));
}

// ============================================
// Hook Implementation
// ============================================

export function useSimulatorAppState<TState extends SimulatorAppBaseState>(
  options: UseSimulatorAppStateOptions<TState>
): UseSimulatorAppStateReturn<TState> {
  const { config, overrideEventId, eventsAtomOverride } = options;
  const { deriveState, id: appType, matchesEvent } = config;

  // ============================================
  // Session Store (Single Source of Truth)
  // ============================================

  // When an override is supplied the events are already Rust-prefiltered,
  // so the matchesEvent predicate is skipped in filterEventsForApp.
  const prefiltered = !!eventsAtomOverride;
  const eventsSource: Atom<SessionEvent[]> =
    eventsAtomOverride ?? EMPTY_EVENTS_ATOM;
  const legacyEvents = useAtomValue(eventsSource);
  const sortedSimulatorEventIds = useAtomValue(sortedSimulatorEventIdsAtom);
  const previewById = useAtomValue(simulatorEventPreviewByIdAtom);
  const eventById = useAtomValue(eventIndexAtom);
  const currentEvent = useAtomValue(currentEventAtom);
  const replayBarValue = useAtomValue(replayBarValueAtom);
  const replayMode = useAtomValue(replayModeAtom);
  const navigateToEvent = useSetAtom(navigateToEventAtom);

  // ============================================
  // Computed Values
  // ============================================

  // Current event ID (from context or override)
  const currentEventId = overrideEventId ?? currentEvent?.id ?? null;

  // Determine if in replay mode
  const isReplaying =
    replayMode === "replay" ||
    (replayBarValue > 0 && replayBarValue < REPLAY_CONFIG.MAX_VALUE);

  const appEventIds = useMemo(() => {
    if (prefiltered) {
      return filterLegacyEventsForApp(
        legacyEvents,
        currentEventId,
        matchesEvent,
        true
      ).map((event) => event.id);
    }

    return filterEventIdsForApp(
      sortedSimulatorEventIds,
      currentEventId,
      previewById,
      appType,
      matchesEvent,
      false
    );
  }, [
    prefiltered,
    legacyEvents,
    currentEventId,
    appType,
    matchesEvent,
    sortedSimulatorEventIds,
    previewById,
  ]);

  const appEvents = useMemo(() => {
    const hydratedEvents = appEventIds
      .map((eventId) => eventById.get(eventId))
      .filter((event): event is SessionEvent => Boolean(event));
    return hydrateFullEventWindow(hydratedEvents);
  }, [appEventIds, eventById]);

  // Derive app-specific state
  const derivedState = useMemo(
    () => deriveState(appEvents, currentEventId),
    [appEvents, currentEventId, deriveState]
  );

  // Build full state object
  const state = useMemo<TState>(
    () =>
      ({
        ...derivedState,
        currentEventId,
        appEvents,
        selectedItemId: null, // Will be managed by local state
        isReplaying,
      }) as TState,
    [derivedState, currentEventId, appEvents, isReplaying]
  );

  // ============================================
  // Local State
  // ============================================

  // Selected item within the app (e.g., selected file, message)
  // Uses a ref to track if user manually selected something different from currentEventId
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null);
  const prevEventIdRef = useRef(currentEventId);

  // Compute selectedItemId: prefer user selection, fall back to currentEventId
  const selectedItemId = useMemo(() => {
    // If currentEventId changed, clear user selection and follow currentEventId
    if (currentEventId !== prevEventIdRef.current) {
      prevEventIdRef.current = currentEventId;
      return currentEventId;
    }
    // Otherwise use user selection if set, else currentEventId
    return userSelectedId ?? currentEventId;
  }, [currentEventId, userSelectedId]);

  // Setter for manual selection
  const setSelectedItemId = useCallback((id: string | null) => {
    setUserSelectedId(id);
  }, []);

  // ============================================
  // Actions
  // ============================================

  /**
   * Jump to a specific event in the replay.
   * Uses navigateToEventAtom for consistent navigation.
   */
  const jumpToEvent = useCallback(
    (eventId: string) => {
      // Use session store navigation (handles bar value + current event)
      navigateToEvent(eventId);
      // Update local selection
      setUserSelectedId(eventId);
    },
    [navigateToEvent]
  );

  // ============================================
  // Return
  // ============================================

  return {
    state: {
      ...state,
      selectedItemId,
    } as TState,
    currentEvent,
    selectedItemId,
    setSelectedItemId,
    isReplaying,
    appEvents,
    jumpToEvent,
  };
}

export default useSimulatorAppState;
