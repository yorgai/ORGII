/**
 * Session Metadata Atoms
 *
 * Session ID, loading status, cache status, and other metadata.
 */
import { atom } from "jotai";

import type { SessionEvent, SessionLoadStatus, SessionSpec } from "../types";

const MAX_SESSION_RELOAD_EPOCH_ENTRIES = 200;

// ============================================
// Session Metadata
// ============================================

/**
 * Current session ID.
 */
export const sessionIdAtom = atom<string | null>(null);
sessionIdAtom.debugLabel = "session/sessionId";

/**
 * Session loading status.
 */
export const loadStatusAtom = atom<SessionLoadStatus>("idle");
loadStatusAtom.debugLabel = "session/loadStatus";

export const loadErrorAtom = atom<string | null>(null);
loadErrorAtom.debugLabel = "session/loadError";

export const sessionReloadEpochMapAtom = atom<Map<string, number>>(new Map());
sessionReloadEpochMapAtom.debugLabel = "session/reloadEpochMap";

export const triggerSessionReloadAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const current = get(sessionReloadEpochMapAtom);
    const next = new Map(current);
    if (next.size >= MAX_SESSION_RELOAD_EPOCH_ENTRIES && !next.has(sessionId)) {
      const firstKey = next.keys().next().value;
      if (firstKey) next.delete(firstKey);
    }
    next.set(sessionId, (current.get(sessionId) ?? 0) + 1);
    set(sessionReloadEpochMapAtom, next);
  }
);
triggerSessionReloadAtom.debugLabel = "session/triggerReload";

// ============================================
// Cache Status
// ============================================

/**
 * Whether current data came from cache.
 */
export const isFromCacheAtom = atom<boolean>(false);
isFromCacheAtom.debugLabel = "session/isFromCache";

/**
 * Last time data was fetched from network.
 */
export const lastFetchedAtom = atom<number | null>(null);
lastFetchedAtom.debugLabel = "session/lastFetched";

/**
 * Whether there are more events to load (pagination).
 */
export const hasMoreEventsAtom = atom<boolean>(false);
hasMoreEventsAtom.debugLabel = "session/hasMoreEvents";

/**
 * Whether currently loading more events.
 */
export const isLoadingMoreAtom = atom<boolean>(false);
isLoadingMoreAtom.debugLabel = "session/isLoadingMore";

// ============================================
// Pending Synthetic User Event
// ============================================

/**
 * Holds the synthetic user event injected by launchSession so it survives
 * clearSessionAtom. loadSessionAtom consumes and merges it when the real
 * data arrives, then clears the atom.
 */
export const pendingSyntheticEventAtom = atom<SessionEvent | null>(null);
pendingSyntheticEventAtom.debugLabel = "session/pendingSyntheticEvent";

// ============================================
// Spec List (for replay bar segments)
// ============================================

export const specsAtom = atom<SessionSpec[]>([]);
specsAtom.debugLabel = "session/specs";
