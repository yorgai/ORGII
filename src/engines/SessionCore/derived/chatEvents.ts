/**
 * Chat Events Derived Atoms
 *
 * Events filtered for ChatPanel display.
 * Now reads directly from the Rust-computed DerivedSnapshot.
 */
import { atom } from "jotai";

import {
  derivedSnapshotAtom,
  eventsAtom,
  streamingDeltaContentAtom,
} from "../core/atoms/events";
import { sessionIdAtom } from "../core/atoms/metadata";
import type { Snapshot } from "../core/store/EventStoreProxy";
import type { SessionEvent } from "../core/types";
import { isVisibleInChat } from "../ingestion/visibilityFilters";
import {
  derivePlanDisplayEvents,
  planEventContentSignature,
} from "./planDisplayEvents";

function isStreamingSnap(snap: Snapshot): boolean {
  return "streaming" in snap && (snap as { streaming: boolean }).streaming;
}

/**
 * Events filtered for ChatPanel display.
 *
 * In the Rust EventStore architecture, chat events are pre-computed
 * and included in the DerivedSnapshot/StreamingSnapshot.
 * Falls back to JS-side filtering when snapshot is not available.
 *
 * Reference stability: returns the previous array reference when the
 * event list is structurally identical to avoid React re-renders.
 * During streaming, always returns fresh references because event
 * content grows while IDs stay the same.
 *
 * The prev cache is keyed by session ID so switching sessions always
 * produces a fresh array reference, preventing stale comparisons that
 * would silently skip re-renders on the incoming session's events.
 */
let _prevSessionId: string | null = null;
let _prevChatEvents: SessionEvent[] = [];

function appendLiveAssistantEvent(
  events: SessionEvent[],
  sessionId: string | null,
  content: string | null
): SessionEvent[] {
  if (!sessionId || !content) return events;
  const liveId = `live-assistant-${sessionId}`;
  const lastEvent = events[events.length - 1];
  if (lastEvent?.id === liveId && lastEvent.displayText === content) {
    return events;
  }
  return [
    ...events.filter((event) => event.id !== liveId),
    {
      id: liveId,
      chunk_id: null,
      sessionId,
      createdAt: "1970-01-01T00:00:00.000Z",
      functionName: "assistant_message",
      uiCanonical: "assistant_message",
      actionType: "assistant",
      args: {},
      result: { observation: content },
      source: "assistant",
      displayText: content,
      displayStatus: "running",
      displayVariant: "message",
      activityStatus: "agent",
      isDelta: true,
    },
  ];
}

export const chatEventsAtom = atom((get) => {
  const snap = get(derivedSnapshotAtom);
  const sessionId = get(sessionIdAtom);

  // Reset prev cache when the active session changes so the stability
  // comparison never runs across two different sessions' event arrays.
  if (sessionId !== _prevSessionId) {
    _prevSessionId = sessionId;
    _prevChatEvents = [];
  }

  const liveContent = sessionId
    ? (get(streamingDeltaContentAtom).get(sessionId) ?? null)
    : null;

  if (snap && "chatEvents" in snap) {
    const next = appendLiveAssistantEvent(
      derivePlanDisplayEvents(snap.chatEvents),
      sessionId,
      liveContent
    );

    if (isStreamingSnap(snap)) {
      _prevChatEvents = next;
      return next;
    }

    const argsChanged = !allArgsStable(next, _prevChatEvents);
    const planContentChanged = !allPlanContentStable(next, _prevChatEvents);

    if (
      next.length === _prevChatEvents.length &&
      next.every((evt, i) => evt.id === _prevChatEvents[i].id) &&
      lastEventStable(next, _prevChatEvents) &&
      !argsChanged &&
      !planContentChanged
    ) {
      return _prevChatEvents;
    }
    _prevChatEvents = next;
    return next;
  }

  // Fallback: no DerivedSnapshot yet (session switch, initial load, or only a
  // raw StreamingSnapshot without chatEvents). Filter JS-side, same as
  // messagesEventsAtom / simulatorEventsAtom do in their own fallback paths.
  const events = get(eventsAtom);
  return appendLiveAssistantEvent(
    derivePlanDisplayEvents(events.filter(isVisibleInChat)),
    sessionId,
    liveContent
  );
});
chatEventsAtom.debugLabel = "session/chatEvents";

function lastEventStable(next: SessionEvent[], prev: SessionEvent[]): boolean {
  if (next.length === 0) return true;
  const lastN = next[next.length - 1];
  const lastP = prev[prev.length - 1];
  return (
    lastN.displayStatus === lastP.displayStatus &&
    lastN.isDelta === lastP.isDelta
  );
}

/**
 * Check that no event's routing-relevant args have changed.
 *
 * We only check the fields that affect which adapter/block is rendered,
 * specifically `args.action` and `args.subagentSessionId`.  A deep
 * comparison of the full args object would be expensive; a shallow
 * reference check would always fail because every Tauri IPC call
 * deserialises into fresh JS objects.
 *
 * This catches the case where stamp_subagent_session_id_on_parent patches
 * `action: "delegate"` + `subagentSessionId` into a still-running tool_call
 * event whose displayStatus/isDelta do not change — the reference stability
 * check above would otherwise return the stale array and React would skip
 * the re-render that switches TitleOnlyAdapter → SubagentAdapter.
 */
function allArgsStable(next: SessionEvent[], prev: SessionEvent[]): boolean {
  if (next.length !== prev.length) return false;
  for (let i = 0; i < next.length; i++) {
    const na = next[i].args as Record<string, unknown> | undefined;
    const pa = prev[i].args as Record<string, unknown> | undefined;
    if (na?.["action"] !== pa?.["action"]) return false;
    if (na?.["subagentSessionId"] !== pa?.["subagentSessionId"]) return false;
  }
  return true;
}

function allPlanContentStable(
  next: SessionEvent[],
  prev: SessionEvent[]
): boolean {
  if (next.length !== prev.length) return false;
  for (let i = 0; i < next.length; i++) {
    if (
      planEventContentSignature(next[i]) !== planEventContentSignature(prev[i])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * JS-side fallback filter for components that need immediate chat filtering
 * before the first snapshot arrives.
 */
export { isVisibleInChat };
