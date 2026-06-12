/**
 * Simulator Events Derived Atoms
 *
 * Events filtered for Simulator display.
 * Includes thread filtering for replay context.
 */
import { atom } from "jotai";

import { AppType } from "@src/engines/Simulator/types/appTypes";
import { getAppTypeForEventSafe } from "@src/engines/Simulator/utils/eventToDockMapping";
import { selectedExecutionThreadAtom } from "@src/store/ui/sessionPaginationAtom";
import {
  simulatorFollowAppLockAtom,
  simulatorSelectedAppAtom,
} from "@src/store/ui/simulatorAtom";

import {
  currentEventIdAtom,
  navigateToEventAtom,
  replayModeAtom,
} from "../core/atoms";
import { derivedSnapshotAtom, eventIndexAtom } from "../core/atoms/events";
import type { DerivedSnapshot } from "../core/store/EventStoreProxy";
import type {
  ReplayMode,
  SessionEvent,
  SimulatorEventPreview,
} from "../core/types";
import { isSubagentSpawningTool } from "../sync/adapters/shared/subagentTracking";

function buildSimulatorEventPreview(
  event: SessionEvent
): SimulatorEventPreview {
  return {
    id: event.id,
    sessionId: event.sessionId,
    createdAt: event.createdAt,
    functionName: event.functionName,
    uiCanonical: event.uiCanonical,
    actionType: event.actionType,
    source: event.source,
    displayText: event.displayText,
    displayStatus: event.displayStatus,
    displayVariant: event.displayVariant,
    activityStatus: event.activityStatus,
    threadId: event.threadId,
    processId: event.processId,
    callId: event.callId,
    filePath: event.filePath,
    command: event.command,
    isDelta: event.isDelta,
    repoId: event.repoId,
    repoPath: event.repoPath,
  };
}

export function getAppTypeForSimulatorPreview(
  preview: SimulatorEventPreview | null | undefined
): AppType | null {
  if (!preview) return null;
  const mapped = getAppTypeForEventSafe(preview.functionName);
  if (mapped !== null) return mapped;
  if (preview.displayVariant === "tool_call" && preview.source !== "user") {
    return AppType.CODE_EDITOR;
  }
  if (preview.source === "user") return AppType.CHANNELS;
  return null;
}

function isEffectiveSimulatorPreview(preview: SimulatorEventPreview): boolean {
  if (
    preview.actionType !== "tool_call" &&
    preview.actionType !== "tool_result"
  ) {
    return true;
  }
  if (!preview.functionName) return true;
  return !isSubagentSpawningTool(preview.functionName);
}

/**
 * Events filtered for Simulator display.
 * Reads from the Rust-computed `sortedSimulatorEvents` (pre-sorted by createdAt then id).
 *
 * Compatibility selector: new simulator navigation/status consumers should prefer
 * `sortedSimulatorEventIdsAtom` and `simulatorEventPreviewByIdAtom`.
 */
export const simulatorEventsAtom = atom((get) => {
  const snap = get(derivedSnapshotAtom);

  if (snap && "sortedSimulatorEvents" in snap) {
    return (snap as DerivedSnapshot).sortedSimulatorEvents;
  }

  // No snapshot yet — simulator visibility is computed exclusively in Rust
  // (derived.rs is_visible_in_simulator); without a snapshot there is nothing
  // pre-filtered to show.
  return [] as SessionEvent[];
});
simulatorEventsAtom.debugLabel = "session/simulatorEvents";

/**
 * Events filtered for the Messages app.
 * Reads from the Rust-computed DerivedSnapshot when available.
 */
export const messagesEventsAtom = atom((get) => {
  const snap = get(derivedSnapshotAtom);

  if (snap && "messagesEvents" in snap) {
    return (snap as DerivedSnapshot).messagesEvents;
  }

  // No derived snapshot baseline — messages visibility is pre-computed in
  // Rust (derived.rs is_visible_in_messages); nothing to show yet.
  return [] as SessionEvent[];
});
messagesEventsAtom.debugLabel = "session/messagesEvents";

/**
 * Sorted simulator-visible event IDs. This is the primary lightweight timeline
 * for simulator navigation and status UI.
 */
export const sortedSimulatorEventIdsAtom = atom((get) => {
  const snap = get(derivedSnapshotAtom);

  if (snap?.sortedSimulatorEventIds) {
    return snap.sortedSimulatorEventIds;
  }

  return get(simulatorEventsAtom).map((event) => event.id);
});
sortedSimulatorEventIdsAtom.debugLabel = "session/sortedSimulatorEventIds";

/**
 * Lightweight simulator event previews keyed by event ID.
 */
export const simulatorEventPreviewByIdAtom = atom((get) => {
  const snap = get(derivedSnapshotAtom);

  if (snap?.eventPreviewById) {
    return snap.eventPreviewById;
  }

  const previewById: Record<string, SimulatorEventPreview> = {};
  for (const event of get(simulatorEventsAtom)) {
    previewById[event.id] = buildSimulatorEventPreview(event);
  }
  return previewById;
});
simulatorEventPreviewByIdAtom.debugLabel = "session/simulatorEventPreviewById";

export const createdAtByIdAtom = atom((get) => {
  const snap = get(derivedSnapshotAtom);
  if (snap?.createdAtById) return snap.createdAtById;

  const createdAtById: Record<string, string> = {};
  const previewById = get(simulatorEventPreviewByIdAtom);
  for (const [id, preview] of Object.entries(previewById)) {
    createdAtById[id] = preview.createdAt;
  }
  return createdAtById;
});
createdAtByIdAtom.debugLabel = "session/createdAtById";

export const threadIdByIdAtom = atom((get) => {
  const snap = get(derivedSnapshotAtom);
  if (snap?.threadIdById) return snap.threadIdById;

  const threadIdById: Record<string, string> = {};
  const previewById = get(simulatorEventPreviewByIdAtom);
  for (const [id, preview] of Object.entries(previewById)) {
    if (preview.threadId) threadIdById[id] = preview.threadId;
  }
  return threadIdById;
});
threadIdByIdAtom.debugLabel = "session/threadIdById";

/**
 * Sorted simulator-visible events.
 * Compatibility selector for consumers that still need full SessionEvent bodies.
 */
export const sortedSimulatorEventsAtom = atom((get) => {
  const snap = get(derivedSnapshotAtom);

  if (snap && "sortedSimulatorEvents" in snap) {
    return (snap as DerivedSnapshot).sortedSimulatorEvents;
  }

  return get(simulatorEventsAtom);
});
sortedSimulatorEventsAtom.debugLabel = "session/sortedSimulatorEvents";

/**
 * Simulator event IDs filtered by current thread selection.
 */
export const simulatorThreadFilteredEventIdsAtom = atom((get) => {
  const eventIds = get(sortedSimulatorEventIdsAtom);
  const threadId = get(selectedExecutionThreadAtom);

  if (!threadId) return eventIds;
  const threadIdById = get(threadIdByIdAtom);
  return eventIds.filter((eventId) => threadIdById[eventId] === threadId);
});
simulatorThreadFilteredEventIdsAtom.debugLabel =
  "session/simulatorThreadFilteredEventIds";

/**
 * Simulator events filtered by current thread selection.
 * Compatibility selector for full-event consumers.
 */
export const simulatorThreadFilteredEventsAtom = atom((get) => {
  const eventIndex = get(eventIndexAtom);
  return get(simulatorThreadFilteredEventIdsAtom)
    .map((eventId) => eventIndex.get(eventId))
    .filter((event): event is SessionEvent => Boolean(event));
});
simulatorThreadFilteredEventsAtom.debugLabel =
  "session/simulatorThreadFilteredEvents";

/**
 * Effective simulator event IDs for replay — thread/app filter when selected,
 * otherwise all sorted simulator-visible IDs.
 */
export const effectiveSimulatorEventIdsAtom = atom((get) => {
  const eventIds = get(simulatorThreadFilteredEventIdsAtom);
  const previewById = get(simulatorEventPreviewByIdAtom);
  const followAppLock = get(simulatorFollowAppLockAtom);

  return eventIds.filter((eventId) => {
    const preview = previewById[eventId];
    if (!preview) return false;

    if (
      followAppLock &&
      getAppTypeForSimulatorPreview(preview) !== followAppLock
    ) {
      return false;
    }

    return isEffectiveSimulatorPreview(preview);
  });
});
effectiveSimulatorEventIdsAtom.debugLabel =
  "session/effectiveSimulatorEventIds";

/**
 * Effective simulator events for replay.
 * Compatibility selector for unmigrated consumers that still need full events.
 */
export const effectiveSimulatorEventsAtom = atom((get) => {
  const eventIndex = get(eventIndexAtom);
  return get(effectiveSimulatorEventIdsAtom)
    .map((eventId) => eventIndex.get(eventId))
    .filter((event): event is SessionEvent => Boolean(event));
});
effectiveSimulatorEventsAtom.debugLabel = "session/effectiveSimulatorEvents";

let _prevEffSimIds: ReadonlyArray<string> = [];
let _prevEffSimIndexMap = new Map<string, number>();

const effectiveSimulatorEventIndexMapAtom = atom((get) => {
  const eventIds = get(effectiveSimulatorEventIdsAtom);
  if (eventIds === _prevEffSimIds) return _prevEffSimIndexMap;
  _prevEffSimIds = eventIds;
  const map = new Map<string, number>();
  for (let idx = 0; idx < eventIds.length; idx++) {
    map.set(eventIds[idx], idx);
  }
  _prevEffSimIndexMap = map;
  return map;
});

/**
 * Current event preview for simulator navigation/status consumers.
 */
export const currentSimulatorPreviewAtom = atom((get) => {
  const currentId = get(currentEventIdAtom);
  if (!currentId) return null;
  return get(simulatorEventPreviewByIdAtom)[currentId] ?? null;
});
currentSimulatorPreviewAtom.debugLabel = "session/currentSimulatorPreview";

/**
 * Current event index in effective simulator events.
 * Returns -1 if current event is not in the filtered list.
 */
export const currentSimulatorEventIndexAtom = atom((get) => {
  const currentId = get(currentEventIdAtom);
  if (!currentId) return -1;
  const indexMap = get(effectiveSimulatorEventIndexMapAtom);
  return indexMap.get(currentId) ?? -1;
});
currentSimulatorEventIndexAtom.debugLabel =
  "session/currentSimulatorEventIndex";

/**
 * Total count of effective simulator events.
 */
export const simulatorEventCountAtom = atom((get) => {
  return get(effectiveSimulatorEventIdsAtom).length;
});
simulatorEventCountAtom.debugLabel = "session/simulatorEventCount";

/**
 * Main replay cursor timestamp (epoch ms), derived from preview metadata.
 */
export const mainReplayCursorMsAtom = atom<number | null>((get) => {
  const currentId = get(currentEventIdAtom);
  if (!currentId) return null;
  const createdAt = get(createdAtByIdAtom)[currentId];
  return createdAt ? new Date(createdAt).getTime() : null;
});
mainReplayCursorMsAtom.debugLabel = "session/mainReplayCursorMs";

// ============================================
// Simulator Navigation Actions
// ============================================

/**
 * Navigate to event by index in effective simulator events.
 * Simply sets currentEventId - slider position is derived from currentIndex.
 */
export const navigateToSimulatorEventByIndexAtom = atom(
  null,
  (get, set, targetIndex: number) => {
    const eventIds = get(effectiveSimulatorEventIdsAtom);
    if (eventIds.length === 0) return;

    const clampedIndex = Math.max(
      0,
      Math.min(eventIds.length - 1, targetIndex)
    );

    set(simulatorSelectedAppAtom, null);
    set(currentEventIdAtom, eventIds[clampedIndex]);
    set(replayModeAtom, "replay" as ReplayMode);
  }
);
navigateToSimulatorEventByIndexAtom.debugLabel =
  "session/navigateToSimulatorEventByIndex";

/**
 * Navigate to event by ID.
 * Uses O(1) Map lookup instead of O(n) findIndex.
 */
export const navigateToSimulatorEventAtom = atom(
  null,
  (get, set, eventId: string) => {
    const indexMap = get(effectiveSimulatorEventIndexMapAtom);
    const targetIndex = indexMap.get(eventId);

    if (targetIndex !== undefined) {
      set(navigateToSimulatorEventByIndexAtom, targetIndex);
      return;
    }
    set(navigateToEventAtom, eventId);
  }
);
navigateToSimulatorEventAtom.debugLabel = "session/navigateToSimulatorEvent";

/**
 * Navigate to next simulator event (index + 1).
 * If current event is not in the filtered list, start from the first event.
 */
export const navigateNextSimulatorEventAtom = atom(null, (get, set) => {
  const eventIds = get(effectiveSimulatorEventIdsAtom);
  if (eventIds.length === 0) return;

  const currentIndex = get(currentSimulatorEventIndexAtom);

  if (currentIndex < 0) {
    set(navigateToSimulatorEventByIndexAtom, 0);
    return;
  }

  if (currentIndex >= eventIds.length - 1) return;

  set(navigateToSimulatorEventByIndexAtom, currentIndex + 1);
});
navigateNextSimulatorEventAtom.debugLabel =
  "session/navigateNextSimulatorEvent";

/**
 * Navigate to previous simulator event (index - 1).
 * If current event is not in the filtered list, start from the last event.
 */
export const navigatePrevSimulatorEventAtom = atom(null, (get, set) => {
  const eventIds = get(effectiveSimulatorEventIdsAtom);
  if (eventIds.length === 0) return;

  const currentIndex = get(currentSimulatorEventIndexAtom);

  if (currentIndex < 0) {
    set(navigateToSimulatorEventByIndexAtom, eventIds.length - 1);
    return;
  }

  if (currentIndex <= 0) return;

  set(navigateToSimulatorEventByIndexAtom, currentIndex - 1);
});
navigatePrevSimulatorEventAtom.debugLabel =
  "session/navigatePrevSimulatorEvent";

/**
 * Navigate to first simulator event (index 0).
 */
export const navigateToFirstSimulatorEventAtom = atom(null, (_get, set) => {
  set(navigateToSimulatorEventByIndexAtom, 0);
});
navigateToFirstSimulatorEventAtom.debugLabel =
  "session/navigateToFirstSimulatorEvent";

/**
 * Navigate to last simulator event.
 */
export const navigateToLastSimulatorEventAtom = atom(null, (get, set) => {
  const eventIds = get(effectiveSimulatorEventIdsAtom);
  if (eventIds.length === 0) return;
  set(navigateToSimulatorEventByIndexAtom, eventIds.length - 1);
});
navigateToLastSimulatorEventAtom.debugLabel =
  "session/navigateToLastSimulatorEvent";
