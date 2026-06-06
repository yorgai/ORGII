import { CANCEL_REASON } from "@src/api/tauri/agent";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { markSessionStreamingStopped } from "@src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/streamHelpers";
import {
  isPendingCancelAtom,
  sessionRuntimeStatusAtom,
  streamRetryStatusAtom,
  userInitiatedCancelAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { streamingDeltaContentAtom } from "../core/atoms";

export type TimelineBoundaryReason = "stop" | "force-send" | "rewind";

export function clearLiveStreamingForSession(sessionId: string): void {
  const store = getInstrumentedStore();
  markSessionStreamingStopped(sessionId);
  store.set(streamRetryStatusAtom, null);
  store.set(streamingDeltaContentAtom, (prev) => {
    if (!prev.has(sessionId)) return prev;
    const next = new Map(prev);
    next.delete(sessionId);
    return next;
  });
  void eventStoreProxy.setStreaming(false, sessionId).catch((error) => {
    console.warn("[sessionTimelineBoundary] setStreaming(false) failed", error);
  });
}

export function beginTimelineBoundary(
  sessionId: string,
  reason: TimelineBoundaryReason
): void {
  const store = getInstrumentedStore();
  clearLiveStreamingForSession(sessionId);
  store.set(sessionRuntimeStatusAtom, "idle");

  if (reason === "stop") {
    store.set(userInitiatedCancelAtom, true);
    store.set(isPendingCancelAtom, true);
    return;
  }

  store.set(userInitiatedCancelAtom, false);
  store.set(isPendingCancelAtom, false);
}

export async function cancelTurnForTimelineBoundary(
  sessionId: string,
  reason: TimelineBoundaryReason
): Promise<void> {
  beginTimelineBoundary(sessionId, reason);
  try {
    await SessionService.interrupt({
      sessionId,
      reason:
        reason === "force-send"
          ? CANCEL_REASON.FORCE_SEND
          : CANCEL_REASON.USER_STOP,
    });
  } catch (error) {
    console.warn("[sessionTimelineBoundary] interrupt failed", error);
  }
}
