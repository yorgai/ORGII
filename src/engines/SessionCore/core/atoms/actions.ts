/**
 * Session Action Atoms (Write-only)
 *
 * Compound actions for session state management.
 * Helpers are in actionsUtils.ts.
 */
import { atom } from "jotai";

import { REPLAY_CONFIG } from "@src/config/workspace/replayConfig";
import { clearLoadedPayloads } from "@src/engines/SessionCore/payloads";
import { clearLoadedTurnRegistry } from "@src/engines/SessionCore/turns/loadedTurnRegistry";

import {
  isVisibleInChat,
  isVisibleInMessages,
  isVisibleInSimulator,
} from "../../ingestion/visibilityFilters";
import {
  isBackendUserMessageEvent,
  isSyntheticUserInputEvent,
} from "../../sync/utils/activityIds";
import { isRunningSessionEvent } from "../runningEventGate";
import { eventStoreProxy } from "../store/EventStoreProxy";
import type { SessionEvent, SessionSpec } from "../types";
import {
  applyRunningArgs,
  extendRunningArgsCache,
  navigateToEventAndUpdateBar,
  resetRunningArgsCache,
  resetSessionUIState,
} from "./actionsUtils";
import {
  derivedSnapshotAtom,
  eventIndexAtom,
  eventsAtom,
  sortedEventsAtom,
} from "./events";
import {
  isFromCacheAtom,
  lastFetchedAtom,
  loadErrorAtom,
  loadStatusAtom,
  pendingSyntheticEventAtom,
  sessionIdAtom,
  specsAtom,
} from "./metadata";
import {
  currentEventIdAtom,
  currentEventIndexAtom,
  replayBarValueAtom,
  replayModeAtom,
  replayTimeRangeAtom,
} from "./replay";

// ============================================
// Compound Actions (Write-only atoms)
// ============================================

export const failSessionLoadAtom = atom(null, (_get, set, message: string) => {
  set(loadErrorAtom, message);
  set(loadStatusAtom, "error");
});
failSessionLoadAtom.debugLabel = "session/failSessionLoad";

export const clearSessionLoadErrorAtom = atom(null, (_get, set) => {
  set(loadErrorAtom, null);
});
clearSessionLoadErrorAtom.debugLabel = "session/clearSessionLoadError";

/**
 * Clear all session state.
 * Use when switching sessions.
 */
export const clearSessionAtom = atom(null, (get, set) => {
  const currentSessionId = get(sessionIdAtom);
  resetRunningArgsCache();
  clearLoadedPayloads();
  if (currentSessionId) {
    clearLoadedTurnRegistry(currentSessionId);
  }
  // NOTE: Do NOT call set(eventsAtom, []) here. eventsAtom's write handler
  // fires eventStoreProxy.set([]) which is an async fire-and-forget IPC to
  // Rust. This races with the sync hook's doSwitch() which also writes to the
  // Rust EventStore via switchSession + set(events). If the clear arrives
  // after the load, it nukes the just-loaded events while loadStatus is
  // already "loaded", causing a permanently blank chat panel.
  // The Rust EventStore handles the session transition atomically inside
  // es_switch_session. Metadata atoms below are cleared synchronously.
  resetSessionUIState(set);
  set(pendingSyntheticEventAtom, null);
  set(currentEventIdAtom, null);
  set(replayBarValueAtom, REPLAY_CONFIG.MAX_VALUE);
  set(replayTimeRangeAtom, { start: "", end: "" });
  set(replayModeAtom, "replay");
  set(sessionIdAtom, null);
  set(loadStatusAtom, "idle");
  set(loadErrorAtom, null);
  set(isFromCacheAtom, false);
  set(lastFetchedAtom, null);
  set(specsAtom, []);

  // Null out the Rust-pushed snapshot so all derived event atoms return [].
  // This is safe: derivedSnapshotAtom is a plain atom (no IPC on write).
  // loadSessionAtom will replace it atomically when a real session loads.
  set(derivedSnapshotAtom, null);
});
clearSessionAtom.debugLabel = "session/clear";

/**
 * Load session with events.
 * Sets all relevant state at once.
 */
interface LoadSessionPayload {
  sessionId: string;
  events: SessionEvent[];
  specs?: SessionSpec[];
  isFromCache?: boolean;
}

export const loadSessionAtom = atom(
  null,
  (get, set, payload: LoadSessionPayload) => {
    const { sessionId, events, specs = [], isFromCache = false } = payload;

    // Preserve synthetic user events (injected by session launch) when the
    // sync hooks reload from SQLite/API before the backend has persisted the
    // user message. Without this, the first message disappears on navigation.
    //
    // Key distinction: synthetic events are frontend user_message rows with an
    // empty uiCanonical, while backend-echoed user turns normalize to
    // functionName/uiCanonical "user". IDs are not reliable because CLI backend
    // user events can also use the user-input-* prefix.
    const currentSessionId = get(sessionIdAtom);
    const existingSameSessionEvents =
      currentSessionId === sessionId ? get(eventsAtom) : [];
    const hasRealBackendUserMessages = events.some(isBackendUserMessageEvent);
    let syntheticUserEvents: SessionEvent[] = [];

    // Source 1: existing events in the store (same session, not yet cleared)
    if (existingSameSessionEvents.length > 0 && !hasRealBackendUserMessages) {
      syntheticUserEvents = existingSameSessionEvents.filter(
        isSyntheticUserInputEvent
      );
    }

    // Source 2: pendingSyntheticEventAtom — survives clearSessionAtom so the
    // user message is recovered even after a session-switch clear.
    if (syntheticUserEvents.length === 0 && !hasRealBackendUserMessages) {
      const pending = get(pendingSyntheticEventAtom);
      if (pending && pending.sessionId === sessionId) {
        syntheticUserEvents = [pending];
      }
    }

    // Only consume the pending event when the backend has echoed the real
    // user message. Until then, keep it around so subsequent loadSessionAtom
    // calls (from sync hooks) can recover it even if the async Rust store
    // write hasn't completed yet.
    if (hasRealBackendUserMessages) {
      set(pendingSyntheticEventAtom, null);
    }

    // Atomic swap: when switching sessions, reset stale state in the same
    // Jotai write batch so there is never a render with empty events.
    // Previously, clearSessionAtom wiped everything first (causing an empty
    // flash), then loadSessionAtom populated new data asynchronously.
    if (currentSessionId !== null && currentSessionId !== sessionId) {
      // Only clear the pending synthetic event if it belongs to the OLD
      // session (or is absent). If the caller set pendingSyntheticEventAtom
      // for the NEW session in the same Jotai batch (e.g. useSessionLaunch),
      // clearing it here would drop the user's first message.
      const pendingNow = get(pendingSyntheticEventAtom);
      if (!pendingNow || pendingNow.sessionId !== sessionId) {
        set(pendingSyntheticEventAtom, null);
      }
      resetSessionUIState(set, currentSessionId);
    }

    set(sessionIdAtom, sessionId);

    resetRunningArgsCache();

    const incomingById = new Map(events.map((event) => [event.id, event]));
    const existingIds = new Set(
      existingSameSessionEvents.map((event) => event.id)
    );
    const baseEvents =
      currentSessionId === sessionId && existingSameSessionEvents.length > 0
        ? existingSameSessionEvents
        : [];
    const eventsForLoad =
      baseEvents.length > 0
        ? [
            ...baseEvents.map((event) => incomingById.get(event.id) ?? event),
            ...events.filter((event) => !existingIds.has(event.id)),
          ]
        : events;
    const argsMap = extendRunningArgsCache(eventsForLoad);
    const enrichedEvents = applyRunningArgs(argsMap, eventsForLoad);

    // Deduplicate: when events already contains the synthetic event (e.g.
    // the initial loadSessionAtom call from launchSession passes it directly),
    // don't prepend a second copy.
    let mergedEvents: SessionEvent[];
    if (syntheticUserEvents.length > 0) {
      const enrichedIds = new Set(enrichedEvents.map((evt) => evt.id));
      const uniqueSynthetic = syntheticUserEvents.filter(
        (evt) => !enrichedIds.has(evt.id)
      );
      mergedEvents =
        uniqueSynthetic.length > 0
          ? [...uniqueSynthetic, ...enrichedEvents]
          : enrichedEvents;
    } else {
      mergedEvents = enrichedEvents;
    }

    if (mergedEvents.some(isBackendUserMessageEvent)) {
      const syntheticDisplayTextByContent = new Map<string, string>();
      for (const event of mergedEvents) {
        if (!isSyntheticUserInputEvent(event)) continue;
        const content =
          typeof event.result?.message === "object" &&
          event.result.message !== null &&
          "content" in event.result.message
            ? String(event.result.message.content ?? "")
            : event.displayText;
        if (content && event.displayText && content !== event.displayText) {
          syntheticDisplayTextByContent.set(content, event.displayText);
        }
      }

      mergedEvents = mergedEvents
        .filter((event) => !isSyntheticUserInputEvent(event))
        .map((event) => {
          if (!isBackendUserMessageEvent(event)) return event;
          const content =
            typeof event.result?.message === "object" &&
            event.result.message !== null &&
            "content" in event.result.message
              ? String(event.result.message.content ?? "")
              : event.displayText;
          const syntheticDisplayText =
            syntheticDisplayTextByContent.get(content);
          if (
            syntheticDisplayText &&
            event.displayText !== syntheticDisplayText
          ) {
            return { ...event, displayText: syntheticDisplayText };
          }
          return event;
        });
    }

    const eventIndex = Object.fromEntries(
      mergedEvents.map((event, index) => [event.id, index])
    );
    set(derivedSnapshotAtom, {
      version: Date.now(),
      eventCount: mergedEvents.length,
      events: mergedEvents,
      chatEvents: mergedEvents.filter(isVisibleInChat),
      messagesEvents: mergedEvents.filter(isVisibleInMessages),
      sortedSimulatorEvents: mergedEvents.filter(isVisibleInSimulator),
      lastEvent: mergedEvents[mergedEvents.length - 1] ?? null,
      eventIndex,
      chatEventCount: mergedEvents.filter(isVisibleInChat).length,
      hasRunningEvent: mergedEvents.some(isRunningSessionEvent),
    });

    // Merge events into Rust EventStore with explicit sessionId.
    // Using set() would overwrite live tool_call/tool_result events that the
    // Rust agent has already pushed via push_events_to_session, causing a race
    // where the frontend load clears the agent's live work. mergeEvents() is
    // safe for both the empty-store case (first launch, equivalent to append)
    // and the cache-hit case (events come from getEvents() so they already
    // include live data — merging them back is a no-op dedup).
    //
    // Explicit sessionId avoids the "active session" fallback that crashes on
    // app restart when Rust has no active session but localStorage has a stale id.
    eventStoreProxy.mergeEvents(mergedEvents, sessionId).catch((err) => {
      console.warn("[loadSession] Failed to sync events to Rust store:", err);
    });
    set(specsAtom, specs);
    set(isFromCacheAtom, isFromCache);
    set(lastFetchedAtom, Date.now());
    set(loadErrorAtom, null);
    set(loadStatusAtom, "loaded");

    // Calculate time range from events - O(n) instead of O(n log n) sort
    if (events.length > 0) {
      let first = events[0];
      let last = events[0];
      let firstTime = new Date(first.createdAt).getTime();
      let lastTime = firstTime;

      for (let idx = 1; idx < events.length; idx++) {
        const event = events[idx];
        const time = new Date(event.createdAt).getTime();
        if (time < firstTime) {
          first = event;
          firstTime = time;
        }
        if (time > lastTime) {
          last = event;
          lastTime = time;
        }
      }

      let endTime = last.createdAt;
      if (firstTime === lastTime) {
        // Add 1 minute buffer if same time
        endTime = new Date(lastTime + 60000).toISOString();
      }

      set(replayTimeRangeAtom, { start: first.createdAt, end: endTime });

      // Find the last simulator-visible event for the initial display.
      // Non-renderable events (session_start, session_end, user messages)
      // have no simulator renderer and would leave the center blank.
      let displayTarget: SessionEvent | null = null;
      for (let idx = events.length - 1; idx >= 0; idx--) {
        if (isVisibleInSimulator(events[idx])) {
          displayTarget = events[idx];
          break;
        }
      }

      // Set to latest visible event and enable follow mode so the simulator
      // auto-follows new events as they arrive via WebSocket/polling
      set(currentEventIdAtom, displayTarget ? displayTarget.id : last.id);
      set(replayBarValueAtom, REPLAY_CONFIG.MAX_VALUE);
      set(replayModeAtom, "follow");
    }
  }
);
loadSessionAtom.debugLabel = "session/load";

/**
 * Append new events (from WebSocket or incremental load).
 *
 * Also merges args from running events into their completed counterparts.
 * Backend sends tool_call as two events: running (with args) + result (args empty).
 * We match by callId and propagate args so downstream consumers (Simulator, ChatPanel)
 * can access file paths, commands, etc.
 */
export const appendEventsAtom = atom(
  null,
  (get, set, newEvents: SessionEvent[]) => {
    // Dedupe by ID — use eventIndexAtom (already-maintained Map) instead of
    // rebuilding a temporary Set on every append
    const existingIndex = get(eventIndexAtom);
    const uniqueNew = newEvents.filter((evt) => !existingIndex.has(evt.id));

    if (uniqueNew.length > 0) {
      // When the backend echoes the real user message, evict the synthetic
      // placeholder so the user doesn't see a duplicate first message.
      // Use a semantic Rust-side removal instead of the getEvents→filter→set
      // pattern; events arriving between a TS-side read and write would be
      // silently dropped.
      const hasRealUserMessage = uniqueNew.some(isBackendUserMessageEvent);
      if (hasRealUserMessage) {
        eventStoreProxy.removeSyntheticUserInputEvents();
      }

      // Incrementally extend the cached running-args map with new events
      // instead of rescanning all existing events (O(newEvents) vs O(allEvents)).
      const argsMap = extendRunningArgsCache(uniqueNew);
      const enrichedNew = applyRunningArgs(argsMap, uniqueNew);

      eventStoreProxy.append(enrichedNew);

      // Update time range if needed
      const currentRange = get(replayTimeRangeAtom);
      const lastNew = uniqueNew[uniqueNew.length - 1];

      if (
        !currentRange.end ||
        new Date(lastNew.createdAt) > new Date(currentRange.end)
      ) {
        set(replayTimeRangeAtom, {
          ...currentRange,
          end: lastNew.createdAt,
        });
      }

      // Auto-follow in live mode — prefer the last visible event so
      // the simulator doesn't jump to an unrenderable session_end
      const mode = get(replayModeAtom);
      if (mode === "follow") {
        let followTarget = lastNew;
        for (let idx = uniqueNew.length - 1; idx >= 0; idx--) {
          if (isVisibleInSimulator(uniqueNew[idx])) {
            followTarget = uniqueNew[idx];
            break;
          }
        }
        set(currentEventIdAtom, followTarget.id);
        set(replayBarValueAtom, REPLAY_CONFIG.MAX_VALUE);
      }
    }
  }
);
appendEventsAtom.debugLabel = "session/appendEvents";

/**
 * Update a single event (e.g., when tool_call completes).
 * Uses O(1) index lookup via EventStore._idIndex.
 */
export const updateEventAtom = atom(
  null,
  (_get, _set, updatedEvent: SessionEvent) => {
    eventStoreProxy.upsert(updatedEvent);
  }
);
updateEventAtom.debugLabel = "session/updateEvent";

/**
 * O(1) update by known event ID.
 * Preferred over updateEventByPredicateAtom when the event ID is known.
 */
export const updateEventByIdAtom = atom(
  null,
  (
    get,
    _set,
    payload: {
      id: string;
      updater: (event: SessionEvent) => SessionEvent;
    }
  ) => {
    const index = get(eventIndexAtom);
    const existing = index.get(payload.id);
    if (existing) {
      const updated = payload.updater(existing);
      eventStoreProxy.upsert(updated);
    }
  }
);
updateEventByIdAtom.debugLabel = "session/updateEventById";

/**
 * Update the first event matching a predicate with a partial update.
 * Uses O(n) scan — prefer updateEventByIdAtom when ID is known.
 */
export const updateEventByPredicateAtom = atom(
  null,
  (
    get,
    _set,
    payload: {
      predicate: (event: SessionEvent) => boolean;
      updater: (event: SessionEvent) => SessionEvent;
    }
  ) => {
    const events = get(eventsAtom);
    const found = events.find(payload.predicate);

    if (found) {
      const updated = payload.updater(found);
      eventStoreProxy.upsert(updated);
    }
  }
);
updateEventByPredicateAtom.debugLabel = "session/updateEventByPredicate";

/**
 * Navigate to a specific event by ID.
 */
export const navigateToEventAtom = atom(null, (get, set, eventId: string) => {
  const index = get(eventIndexAtom);
  const event = index.get(eventId);
  if (event) {
    navigateToEventAndUpdateBar(get, set, event);
  }
});
navigateToEventAtom.debugLabel = "session/navigateToEvent";

/**
 * Navigate to next event.
 */
export const navigateNextAtom = atom(null, (get, set) => {
  const currentIndex = get(currentEventIndexAtom);
  const sorted = get(sortedEventsAtom);

  if (currentIndex < sorted.length - 1) {
    navigateToEventAndUpdateBar(get, set, sorted[currentIndex + 1]);
  }
});
navigateNextAtom.debugLabel = "session/navigateNext";

/**
 * Navigate to previous event.
 */
export const navigatePrevAtom = atom(null, (get, set) => {
  const currentIndex = get(currentEventIndexAtom);
  const sorted = get(sortedEventsAtom);

  if (currentIndex > 0) {
    navigateToEventAndUpdateBar(get, set, sorted[currentIndex - 1]);
  }
});
navigatePrevAtom.debugLabel = "session/navigatePrev";

/**
 * Switch to live mode (follow latest).
 */
export const goLiveAtom = atom(null, (get, set) => {
  const sorted = get(sortedEventsAtom);

  set(replayModeAtom, "follow");
  set(replayBarValueAtom, REPLAY_CONFIG.MAX_VALUE);

  if (sorted.length > 0) {
    // Prefer the last simulator-visible event so the center
    // doesn't land on an unrenderable session_end
    let target = sorted[sorted.length - 1];
    for (let idx = sorted.length - 1; idx >= 0; idx--) {
      if (isVisibleInSimulator(sorted[idx])) {
        target = sorted[idx];
        break;
      }
    }
    set(currentEventIdAtom, target.id);
  }
});
goLiveAtom.debugLabel = "session/goLive";
