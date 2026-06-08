import { CANCEL_REASON } from "@src/api/tauri/agent";
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
  clearLiveStreamingForSession(sessionId);
  if (reason === "stop") {
    void killActiveShellProcessesForStop(sessionId).catch((error) => {
      console.warn(
        "[sessionTimelineBoundary] failed to kill active shell processes",
        error
      );
    });
  }
  if (reason !== "force-send") {
    void closeRunningEventsForTimelineBoundary(sessionId, reason).catch(
      (error) => {
        console.warn(
          "[sessionTimelineBoundary] failed to close running events",
          error
        );
      }
    );
  }
  store.set(setSessionRuntimeStatusAtom, {
    status: "idle",
    source: "timeline-boundary",
  });

  if (reason === "stop") {
    store.set(userInitiatedCancelAtom, true);
    store.set(isPendingCancelAtom, true);
    return;
  }

  store.set(userInitiatedCancelAtom, false);
  store.set(isPendingCancelAtom, false);
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
