import { atom } from "jotai";

const MAX_COLLAPSE_ENTRIES = 200;
const MAX_TURN_OVERRIDE_ENTRIES = 200;

/**
 * Session-scoped collapse state for chat blocks.
 * Maps eventId -> collapsed (boolean) so user toggles persist
 * across scroll-out/scroll-in re-mounts within the same session.
 */
export const collapseStateAtom = atom<Map<string, boolean>>(new Map());

export const setCollapseStateAtom = atom(
  null,
  (
    get,
    set,
    { eventId, collapsed }: { eventId: string; collapsed: boolean }
  ) => {
    const current = new Map(get(collapseStateAtom));
    if (current.size >= MAX_COLLAPSE_ENTRIES && !current.has(eventId)) {
      const firstKey = current.keys().next().value;
      if (firstKey) current.delete(firstKey);
    }
    current.set(eventId, collapsed);
    set(collapseStateAtom, current);
  }
);

/**
 * Per-session epoch counter for "collapse all" in the chat panel.
 * Maps sessionId -> monotonic epoch.
 * Only the targeted session's blocks react to the increment.
 */
export const collapseAllEpochMapAtom = atom<Map<string, number>>(new Map());

/** Read-only: get the epoch for a specific session (0 if never triggered). */
export function selectCollapseEpoch(
  epochMap: Map<string, number>,
  sessionId: string | undefined
): number {
  if (!sessionId) return 0;
  return epochMap.get(sessionId) ?? 0;
}

/** Write-only: bump the collapse-all epoch for one session. */
export const triggerCollapseAllAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const current = get(collapseAllEpochMapAtom);
    const next = new Map(current);
    next.set(sessionId, (current.get(sessionId) ?? 0) + 1);
    set(collapseAllEpochMapAtom, next);
    set(turnCollapseOverrideAtom, new Map());
  }
);

// ============================================
// Per-turn collapse state (Cursor-style "Worked for xxx")
// ============================================

/**
 * Per-turn collapse override map keyed by `turnId` (the user-message event
 * id at the head of a chat group). Completed turns are collapsed by default;
 * this map only records explicit user overrides via the pin-bar chevron.
 *
 *   undefined  -> default behaviour (completed = collapsed, active = expanded)
 *   true       -> user forced this turn collapsed
 *   false      -> user forced this turn expanded
 */
export const turnCollapseOverrideAtom = atom<Map<string, boolean>>(new Map());

export const setTurnCollapseOverrideAtom = atom(
  null,
  (
    get,
    set,
    { turnId, collapsed }: { turnId: string; collapsed: boolean | undefined }
  ) => {
    const current = new Map(get(turnCollapseOverrideAtom));
    if (collapsed === undefined) {
      current.delete(turnId);
    } else {
      if (current.size >= MAX_TURN_OVERRIDE_ENTRIES && !current.has(turnId)) {
        const firstKey = current.keys().next().value;
        if (firstKey) current.delete(firstKey);
      }
      current.set(turnId, collapsed);
    }
    set(turnCollapseOverrideAtom, current);
  }
);
