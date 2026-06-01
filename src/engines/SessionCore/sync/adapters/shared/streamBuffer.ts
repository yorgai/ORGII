/**
 * Throttled Stream Delta Buffer
 *
 * Tokens arrive every ~10-30ms during streaming. Without throttling, each
 * token triggers a separate Tauri IPC `invoke("es_upsert", ...)` roundtrip.
 * The Rust side already coalesces notifications at ~33ms, but the IPC
 * overhead of individual calls is still significant.
 *
 * This module buffers the latest event per stream ID and flushes at a
 * fixed interval, reducing IPC calls by ~3-5x during fast streaming.
 */
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type {
  EventDisplayStatus,
  SessionEvent,
} from "@src/engines/SessionCore/core/types";
import { BoundedMap } from "@src/util/collections/BoundedMap";

import { makeAssistantEvent, makeThinkingEvent } from "./eventFactories";
import { stripThinkTags } from "./streamingParsers";
import { capStreamContent } from "./subagentTracking";
import type { StreamRefs } from "./types";

const STREAM_FLUSH_INTERVAL_MS = 16;

/**
 * Upper bound on the in-flight pending-flush map. In normal operation
 * the timer drains the map every ~16ms so there is essentially no
 * pressure. The cap is a belt-and-suspenders guard for two failure
 * shapes:
 *
 *   1. A subagent / streaming pathway that pushes deltas but somehow
 *      never reaches the timer-driven flush path (e.g. throws before
 *      `scheduleFlush()` is reached, or the timer is cleared without
 *      being rescheduled). Without a cap the map would grow with every
 *      delta forever.
 *   2. A pathological burst where deltas arrive faster than `setTimeout`
 *      can dispatch them — the timer event loop is starved for several
 *      seconds and the map balloons before any flush fires.
 *
 * 512 is comfortably above realistic concurrent stream counts (a chat
 * panel typically sees 1-5 concurrent streams; a heavy subagent fanout
 * tops out around 50) but small enough that the eviction sweep is
 * O(1) amortized. When the cap kicks in the evicted event is flushed
 * synchronously so user content is never silently dropped.
 */
const MAX_PENDING_FLUSH_ENTRIES = 512;
const pendingFlush = new BoundedMap<string, SessionEvent>({
  maxSize: MAX_PENDING_FLUSH_ENTRIES,
  name: "streamBuffer.pendingFlush",
  onEvict: (_id, event) => {
    eventStoreProxy.upsert(event);
  },
});
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flushPendingStreamDeltas, STREAM_FLUSH_INTERVAL_MS);
}

export function flushPendingStreamDeltas(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingFlush.size === 0) return;
  const events = [...pendingFlush.values()];
  pendingFlush.clear();
  for (const event of events) {
    eventStoreProxy.upsert(event);
  }
}

export function finalizeStream(
  refs: StreamRefs,
  _sessionId: string
): string | null {
  const currentId = refs.idRef.current;
  if (!currentId) return null;

  const isThinking =
    currentId.startsWith("stream-think-ts-") ||
    currentId.startsWith("thinking-");
  const finalContent = isThinking
    ? refs.contentRef.current
    : stripThinkTags(refs.contentRef.current);

  if (pendingFlush.has(currentId)) {
    const finalEvent = isThinking
      ? makeThinkingEvent(currentId, _sessionId, finalContent, false)
      : makeAssistantEvent(currentId, _sessionId, finalContent, false);
    pendingFlush.set(currentId, finalEvent);
  }

  flushPendingStreamDeltas();

  eventStoreProxy.updateById(
    currentId,
    {
      displayText: finalContent,
      displayStatus: "completed" as EventDisplayStatus,
      isDelta: false,
      result: { observation: finalContent },
      ...(isThinking ? { actionType: "llm_thinking" as const } : {}),
    },
    _sessionId
  );

  refs.contentRef.current = "";
  refs.idRef.current = "";
  return currentId;
}

export function appendStreamDelta(
  refs: StreamRefs,
  delta: string,
  idPrefix: string,
  sessionId: string,
  isThinking: boolean
): void {
  refs.contentRef.current += delta;
  refs.contentRef.current = capStreamContent(refs.contentRef.current);
  if (!refs.idRef.current) {
    refs.idRef.current = isThinking
      ? `stream-think-ts-${sessionId}-${Date.now()}`
      : `stream-msg-ts-${sessionId}-${Date.now()}`;
  }
  const currentId = refs.idRef.current;
  const currentContent = refs.contentRef.current;

  const event = isThinking
    ? makeThinkingEvent(currentId, sessionId, currentContent, true)
    : makeAssistantEvent(currentId, sessionId, currentContent, true);

  pendingFlush.set(currentId, event);
  scheduleFlush();
}

/**
 * Current number of buffered (un-flushed) stream events. Exported
 * for unit tests / diagnostics; not part of the public adapter API.
 */
export function getPendingFlushSize(): number {
  return pendingFlush.size;
}

/**
 * Hard cap on the pending-flush map. Exported for tests so they can
 * assert against the configured ceiling without re-deriving it from
 * private constants.
 */
export const PENDING_FLUSH_MAX_ENTRIES = MAX_PENDING_FLUSH_ENTRIES;

export function resetStreamRefs(refs: StreamRefs): void {
  const pendingId = refs.idRef.current;
  if (pendingId && pendingFlush.has(pendingId)) {
    flushPendingStreamDeltas();
  }
  refs.contentRef.current = "";
  refs.idRef.current = "";
}
