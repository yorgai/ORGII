import { CANCEL_REASON } from "@src/api/tauri/agent";
import {
  beginTurnStopping,
  forceTurnIdle,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { isTimelineBoundaryClosableRuntimeEvent } from "@src/engines/SessionCore/core/runningEventGate";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { markSessionStreamingStopped } from "@src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/streamHelpers";
import { killAgentShellProcess } from "@src/services/terminal";
import {
  isPendingCancelAtom,
  isSessionActiveAtom,
  sessionRuntimeStatusAtom,
  setSessionRuntimeStatusAtom,
  streamRetryStatusAtom,
  userInitiatedCancelAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { shellProcessMapAtom } from "@src/store/session/shellProcessAtom";
import { holdSessionQueueForStopAtom } from "@src/store/ui/messageQueueAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { streamingDeltaContentAtom } from "../core/atoms";

export type TimelineBoundaryReason = "stop" | "force-send" | "rewind";

const interruptInFlightByBoundary = new Set<string>();

function boundaryKey(
  sessionId: string,
  reason: TimelineBoundaryReason
): string {
  return `${reason}:${sessionId}`;
}

function reasonToCancelReason(reason: TimelineBoundaryReason) {
  return reason === "force-send"
    ? CANCEL_REASON.FORCE_SEND
    : CANCEL_REASON.USER_STOP;
}

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
}

async function killActiveShellProcessesForStop(
  sessionId: string
): Promise<void> {
  const processes = getInstrumentedStore()
    .get(shellProcessMapAtom)
    .get(sessionId);
  if (!processes) return;

  await Promise.allSettled(
    [...processes.values()]
      .filter(
        (process) =>
          process.status === "running" || process.status === "background"
      )
      .map((process) => killAgentShellProcess({ pid: process.pid, sessionId }))
  );
}

async function closeRunningEventsForTimelineBoundary(
  sessionId: string,
  reason: TimelineBoundaryReason
): Promise<void> {
  const events = await eventStoreProxy.getEvents(sessionId);
  const runningEventIds = events
    .filter((event) => isTimelineBoundaryClosableRuntimeEvent(event, sessionId))
    .map((event) => event.id);
  if (runningEventIds.length === 0) return;

  await eventStoreProxy.patchByIds(
    runningEventIds,
    {
      displayStatus: reason === "rewind" ? "completed" : "failed",
      activityStatus: "processed",
    },
    sessionId
  );
}

function shouldInterruptForTimelineBoundary(
  _sessionId: string,
  reason: TimelineBoundaryReason
): boolean {
  if (reason !== "rewind") return true;

  const store = getInstrumentedStore();
  const runtimeStatus = store.get(sessionRuntimeStatusAtom);
  return (
    store.get(isSessionActiveAtom) ||
    runtimeStatus === "running" ||
    runtimeStatus === "installing"
  );
}

export function beginTimelineBoundary(
  sessionId: string,
  reason: TimelineBoundaryReason
): void {
  const store = getInstrumentedStore();
  const isUserStop = reason === "stop";

  // Drive the turn-lifecycle FSM first so any submit/dispatch racing this
  // boundary already observes the new phase.
  // - stop / force-send: the turn stays blocked ("stopping") until the
  //   provider confirms the cancel with a terminal (bounded by the FSM's
  //   stopping dead-man).
  // - rewind: the timeline is being rewritten — force idle immediately and
  //   invalidate any in-flight terminal of the overridden turn.
  if (reason === "rewind") {
    forceTurnIdle(sessionId);
  } else {
    beginTurnStopping(sessionId);
  }

  if (isUserStop) {
    store.set(userInitiatedCancelAtom, true);
    store.set(isPendingCancelAtom, true);
    // Stop parks every queued follow-up of this session: the natural drain
    // skips them permanently; only an explicit Send Now dispatches them.
    store.set(holdSessionQueueForStopAtom, sessionId);
  } else {
    store.set(userInitiatedCancelAtom, false);
    store.set(isPendingCancelAtom, false);
  }

  clearLiveStreamingForSession(sessionId);
  if (isUserStop) {
    void killActiveShellProcessesForStop(sessionId).catch((error) => {
      console.warn(
        "[sessionTimelineBoundary] failed to kill active shell processes",
        error
      );
    });
  }
  // All boundary causes close the interrupted turn's running events. For
  // force-send this is what clears stale `displayStatus:"running"` rows that
  // would otherwise keep `anyRunning` true in usePlanningIndicator and
  // suppress the planning footer after the redispatch. Idempotent with the
  // provider terminal's own close (rendered-status merge tolerates it).
  void closeRunningEventsForTimelineBoundary(sessionId, reason).catch(
    (error) => {
      console.warn(
        "[sessionTimelineBoundary] failed to close running events",
        error
      );
    }
  );
  if (reason === "force-send") {
    // Send Now guarantees a redispatch the moment the provider confirms the
    // cancel — from the user's point of view the turn continues. Writing
    // `idle` here blanked the planning footer for the whole interrupt window
    // (the "force-send looks stuck" bug); keep the status mirror `running`
    // and let the redispatch / terminal own the next transition.
    return;
  }
  store.set(setSessionRuntimeStatusAtom, {
    sessionId,
    status: "idle",
    source: "timeline-boundary",
  });
}

export function beginStopBoundary(sessionId: string): void {
  beginTimelineBoundary(sessionId, "stop");
}

export function isTimelineInterruptInFlight(
  sessionId: string,
  reason: TimelineBoundaryReason
): boolean {
  return interruptInFlightByBoundary.has(boundaryKey(sessionId, reason));
}

export async function cancelTurnForTimelineBoundary(
  sessionId: string,
  reason: TimelineBoundaryReason,
  options: { onError?: (message: string) => void } = {}
): Promise<void> {
  beginTimelineBoundary(sessionId, reason);
  if (!shouldInterruptForTimelineBoundary(sessionId, reason)) return;
  const key = boundaryKey(sessionId, reason);
  if (interruptInFlightByBoundary.has(key)) return;
  interruptInFlightByBoundary.add(key);
  try {
    await SessionService.interrupt({
      sessionId,
      reason: reasonToCancelReason(reason),
      onError: options.onError,
    });
  } catch (error) {
    console.warn("[sessionTimelineBoundary] interrupt failed", error);
    if (options.onError) {
      options.onError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    interruptInFlightByBoundary.delete(key);
  }
}
