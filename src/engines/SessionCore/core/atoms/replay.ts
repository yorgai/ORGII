/**
 * Replay State Atoms
 *
 * Manages replay bar state, current event selection, and replay mode.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import type { ReplayMode, ReplayTimeRange } from "../types";
import { eventIndexAtom, sortedEventIndexMapAtom } from "./events";

// ============================================
// Helpers
// ============================================

/**
 * Create a sessionStorage adapter for atomWithStorage.
 * Eliminates boilerplate for try/catch + JSON parse/stringify.
 */
function createSessionStorageAdapter<T>(defaultValue: T) {
  return {
    getItem: (key: string): T => {
      try {
        const value = sessionStorage.getItem(key);
        return value ? JSON.parse(value) : defaultValue;
      } catch {
        return defaultValue;
      }
    },
    setItem: (key: string, value: T): void => {
      try {
        sessionStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Ignore storage errors
      }
    },
    removeItem: (key: string): void => {
      sessionStorage.removeItem(key);
    },
  };
}

// ============================================
// Replay State
// ============================================

/**
 * Currently selected event ID for replay.
 * Persisted to sessionStorage to survive tab switches.
 */
export const currentEventIdAtom = atomWithStorage<string | null>(
  "session_currentEventId",
  null,
  createSessionStorageAdapter<string | null>(null)
);
currentEventIdAtom.debugLabel = "session/currentEventId";

/**
 * Currently selected event (derived from ID).
 */
export const currentEventAtom = atom((get) => {
  const eventId = get(currentEventIdAtom);
  if (!eventId) return null;
  return get(eventIndexAtom).get(eventId) ?? null;
});
currentEventAtom.debugLabel = "session/currentEvent";

/**
 * Index of current event in sorted events list.
 */
export const currentEventIndexAtom = atom((get) => {
  const eventId = get(currentEventIdAtom);
  if (!eventId) return -1;
  return get(sortedEventIndexMapAtom).get(eventId) ?? -1;
});
currentEventIndexAtom.debugLabel = "session/currentEventIndex";

/**
 * Replay bar value (0-200 range for slider).
 * Persisted to sessionStorage.
 */
export const replayBarValueAtom = atomWithStorage<number>(
  "session_replayBarValue",
  200,
  createSessionStorageAdapter<number>(200)
);
replayBarValueAtom.debugLabel = "session/replayBarValue";

/**
 * Time range for replay bar (start/end timestamps).
 */
export const replayTimeRangeAtom = atom<ReplayTimeRange>({
  start: "",
  end: "",
});
replayTimeRangeAtom.debugLabel = "session/replayTimeRange";

/**
 * Whether time range is valid (has both start and end).
 */
export const replayTimeRangeValidAtom = atom((get) => {
  const range = get(replayTimeRangeAtom);
  return Boolean(range.start && range.end && range.start !== range.end);
});
replayTimeRangeValidAtom.debugLabel = "session/replayTimeRangeValid";

/**
 * Current replay mode.
 * - "follow": Following latest events (auto-scroll to new events)
 * - "replay": Viewing historical event (no auto-scroll)
 * Default to "replay" to avoid auto-scrolling annoyance in historical sessions.
 */
export const replayModeAtom = atom<ReplayMode>("replay");
replayModeAtom.debugLabel = "session/replayMode";
