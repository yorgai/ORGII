/**
 * Per-session ChatEvents pipeline.
 *
 * The default `chatEventsAtom` is keyed to the globally-active session
 * (`sessionIdAtom`). That is correct for the primary ChatPanel which always
 * mirrors the active session, but it cannot serve the subagent bottom strip
 * where multiple ChatHistory instances must concurrently render different
 * subagent sessions.
 *
 * This module exposes a session-scoped atom family that subscribes directly
 * to the per-session snapshot channel on `eventStoreProxy`, so each
 * ChatHistory instance with a `ChatSessionContext` override reads its own
 * snapshot stream. The global atom is left untouched.
 *
 * Race-safety notes:
 *
 * - Each atom-family entry owns its own `_prevChatEvents` cache via closure,
 *   so the reference-stability comparison cannot bleed across sessions the
 *   way the module-level cache in `chatEvents.ts` does.
 * - The subscription is established eagerly in `onMount` and cleaned up in
 *   the returned disposer; a `getLatestSessionSnapshot` poll closes the race
 *   between mount and the next push.
 * - When the family entry is garbage-collected (no subscriber), the disposer
 *   tears down the per-session subscription. The Rust EventStore keeps its
 *   own LRU cache; we only mirror what is currently mounted.
 */
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

import type { Snapshot } from "../core/store/EventStoreProxy";
import {
  eventStoreProxy,
  isStreamingSnapshot,
} from "../core/store/EventStoreProxy";
import type { SessionEvent } from "../core/types";
import {
  derivePlanDisplayEvents,
  planEventContentSignature,
} from "./planDisplayEvents";

interface SnapshotState {
  snapshot: Snapshot | null;
  loadStarted: boolean;
}

const EMPTY_STATE: SnapshotState = {
  snapshot: null,
  loadStarted: false,
};

/**
 * Backing snapshot atom for a single subagent session.
 *
 * Subscribes to `eventStoreProxy.subscribeSession(sessionId, ...)` on mount,
 * primes itself with `getLatestSessionSnapshot`, and triggers a one-shot
 * `loadFromCache` so a fresh subagent that has not been fetched yet hydrates
 * without requiring the consumer to call `useSessionEvents` separately.
 */
const sessionSnapshotAtomFamily = atomFamily((sessionId: string) => {
  const a = atom<SnapshotState>(EMPTY_STATE);
  a.debugLabel = `session/${sessionId}/snapshot`;

  a.onMount = (setSelf) => {
    let disposed = false;

    setSelf((prev) => {
      if (prev.loadStarted) return prev;
      const cached = eventStoreProxy.getLatestSessionSnapshot(sessionId);
      return {
        snapshot: cached ?? prev.snapshot,
        loadStarted: true,
      };
    });

    const unsubscribe = eventStoreProxy.subscribeSession(
      sessionId,
      (snapshot) => {
        if (disposed) return;
        setSelf({ snapshot, loadStarted: true });
      }
    );

    // Best-effort hydration. If the session is already in the Rust LRU
    // cache this triggers a `schedule_notify` and the snapshot lands via
    // the subscription above; if it is not loaded yet, Rust loads it from
    // SQLite. We do not await — the subscription handles the push.
    void eventStoreProxy.loadFromCache(sessionId).catch((err: unknown) => {
      // Swallow load errors here: the consumer (ChatHistory) is allowed
      // to render an empty state. `useSessionEvents` already covers
      // explicit error surfacing for callers that need it.
      console.warn(
        `[sessionScopedChatEvents] loadFromCache(${sessionId}) failed:`,
        err
      );
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  };

  return a;
});

function extractChatEvents(snapshot: Snapshot | null): SessionEvent[] {
  if (!snapshot) return [];
  if (isStreamingSnapshot(snapshot)) {
    return snapshot.chatEvents;
  }
  if ("chatEvents" in snapshot) {
    return snapshot.chatEvents;
  }
  return [];
}

function chatEventsStable(
  next: SessionEvent[],
  prev: SessionEvent[],
  streaming: boolean
): boolean {
  if (streaming) return false;
  if (next.length !== prev.length) return false;
  for (let i = 0; i < next.length; i++) {
    if (next[i].id !== prev[i].id) return false;
    if (next[i].displayStatus !== prev[i].displayStatus) return false;
    if (next[i].isDelta !== prev[i].isDelta) return false;
    const na = next[i].args as Record<string, unknown> | undefined;
    const pa = prev[i].args as Record<string, unknown> | undefined;
    if (na?.["action"] !== pa?.["action"]) return false;
    if (na?.["subagentSessionId"] !== pa?.["subagentSessionId"]) return false;
    if (
      planEventContentSignature(next[i]) !== planEventContentSignature(prev[i])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Session-scoped chat events. Each family entry has its own `_prev` closure
 * so the reference-stability check cannot leak across sessions even when
 * multiple ChatHistory instances render in parallel inside the subagent
 * bottom strip.
 */
export const chatEventsForSessionAtomFamily = atomFamily(
  (sessionId: string) => {
    let prevChatEvents: SessionEvent[] = [];

    const a = atom((get) => {
      const { snapshot } = get(sessionSnapshotAtomFamily(sessionId));
      const next = derivePlanDisplayEvents(extractChatEvents(snapshot));
      const streaming = snapshot ? isStreamingSnapshot(snapshot) : false;
      if (chatEventsStable(next, prevChatEvents, streaming)) {
        return prevChatEvents;
      }
      prevChatEvents = next;
      return next;
    });
    a.debugLabel = `session/${sessionId}/chatEvents`;
    return a;
  }
);
