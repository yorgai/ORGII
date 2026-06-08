import type { SetStateAction } from "react";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type {
  SessionEvent,
  SessionLoadStatus,
} from "@src/engines/SessionCore/core/types";
import {
  markQueueTurnSettled,
  markQueueTurnWorking,
} from "@src/engines/SessionCore/hooks/session/queueTurnGate";
import { type SessionStatus, updateSessionStatus } from "@src/store/session";
import type {
  ContextBreakdown,
  StreamRetryStatus,
} from "@src/store/session/cliSessionStatusAtom";
import type { CliSessionStatus } from "@src/types/session/session";

import { toCliSessionStatus } from "./sessionSyncUtils";
import type {
  EventHandlerCallbacks,
  PostLoadResult,
  StreamingDeltaInfo,
} from "./types";

type LoadSessionPayload = {
  sessionId: string;
  events: SessionEvent[];
  isFromCache?: boolean;
};

export interface SessionSwitchStateActions {
  clearSessionLoadError: () => void;
  setWpReadOnly: (value: boolean) => void;
  setSessionContextTokens: (value: number) => void;
  setSessionContextBreakdown: (value: ContextBreakdown | null) => void;
  setSessionRuntimeStatus: (value: CliSessionStatus) => void;
  setSessionRuntimeError: (value: string | null) => void;
  setPendingCancel: (value: boolean) => void;
  setStreamRetryStatus: (value: StreamRetryStatus | null) => void;
}

export interface SessionLoadStateActions {
  dispatchLoadSession: (payload: LoadSessionPayload) => void;
  failSessionLoad: (message: string) => void;
  setLoadStatus: (status: SessionLoadStatus) => void;
  setEvents: (update: SetStateAction<SessionEvent[]>) => void;
  setWpReadOnly: (value: boolean) => void;
  setSessionContextTokens: (value: number) => void;
  setSessionRuntimeStatus: (value: CliSessionStatus) => void;
  setSessionRuntimeError: (value: string | null) => void;
}

export interface SessionEventHandlerStateActions {
  setSessionContextTokens: (value: number) => void;
  setSessionContextBreakdown: (value: ContextBreakdown | null) => void;
  setSessionRuntimeStatus: (value: CliSessionStatus) => void;
  setSessionRuntimeError: (value: string | null) => void;
  setPendingCancel: (value: boolean) => void;
  setSessionRolledBack: (value: boolean) => void;
  setStreamingDeltaContent: (
    update: SetStateAction<Map<string, string>>
  ) => void;
}

const TERMINAL_HANDLER_STATUSES = new Set<string>([
  "completed",
  "failed",
  "cancelled",
]);
export function resetSessionSwitchState(
  actions: SessionSwitchStateActions
): void {
  actions.setWpReadOnly(false);
  actions.clearSessionLoadError();
  actions.setSessionRuntimeStatus("idle");
  actions.setSessionRuntimeError(null);
  actions.setPendingCancel(false);
  actions.setStreamRetryStatus(null);
  actions.setSessionContextTokens(0);
  actions.setSessionContextBreakdown(null);
}

export function applyPostLoadResult(
  sessionId: string,
  postResult: PostLoadResult | null | undefined,
  actions: Pick<
    SessionLoadStateActions,
    | "setSessionContextTokens"
    | "setSessionRuntimeStatus"
    | "setSessionRuntimeError"
  >
): void {
  if (!postResult) return;
  if (postResult.contextTokens !== undefined) {
    actions.setSessionContextTokens(postResult.contextTokens);
  }
  if (postResult.runStatus !== undefined) {
    actions.setSessionRuntimeStatus(toCliSessionStatus(postResult.runStatus));
    updateSessionStatus(sessionId, postResult.runStatus as SessionStatus);
  }
  if (postResult.runError !== undefined) {
    actions.setSessionRuntimeError(postResult.runError);
  }
}

export function appendRecoveredEvents(
  recoveredEvents: SessionEvent[],
  setEvents: SessionLoadStateActions["setEvents"]
): void {
  if (recoveredEvents.length === 0) return;
  setEvents((prev) => {
    const existingIds = new Set(prev.map((event) => event.id));
    const uniqueEvents = recoveredEvents.filter(
      (event) => !existingIds.has(event.id)
    );
    if (uniqueEvents.length === 0) return prev;
    return [...prev, ...uniqueEvents];
  });
}

export function updateStreamingDeltaContent(
  sessionId: string,
  info: StreamingDeltaInfo,
  setStreamingDeltaContent: SessionEventHandlerStateActions["setStreamingDeltaContent"]
): void {
  setStreamingDeltaContent((prev) => {
    const next = new Map(prev);
    if (info.isStreaming && !info.isThinking) {
      next.set(sessionId, info.content);
    } else {
      next.delete(sessionId);
    }
    return next;
  });
}

export function createSessionEventHandlerCallbacks(
  sessionId: string,
  actions: SessionEventHandlerStateActions,
  logStatusChange: (status: string, errorMessage?: string) => void
): EventHandlerCallbacks {
  return {
    onAgentComplete: (tokenUsage) => {
      eventStoreProxy.unpinSession(sessionId);
      if (tokenUsage && tokenUsage.contextTokens > 0) {
        actions.setSessionContextTokens(tokenUsage.contextTokens);
      }
      if (tokenUsage?.contextBreakdown) {
        actions.setSessionContextBreakdown(tokenUsage.contextBreakdown);
      }
    },
    onStatusChange: (status, errorMessage, meta) => {
      logStatusChange(status, errorMessage);
      actions.setSessionRuntimeStatus(toCliSessionStatus(status));
      if (status === "failed" && errorMessage) {
        actions.setSessionRuntimeError(errorMessage);
      }
      if (TERMINAL_HANDLER_STATUSES.has(status)) {
        markQueueTurnSettled(
          sessionId,
          Date.now(),
          meta?.turnId,
          meta?.turnStatus ?? status
        );
        actions.setPendingCancel(false);
        eventStoreProxy.unpinSession(sessionId);
        updateSessionStatus(sessionId, status as SessionStatus);
      }
      if (status === "running") {
        markQueueTurnWorking(sessionId);
        actions.setSessionRuntimeError(null);
        eventStoreProxy.pinSession(sessionId);
        actions.setSessionRolledBack(false);
      }
    },
    onTokenUpdate: (tokens) => {
      actions.setSessionContextTokens(tokens);
    },
    onStreamingDelta: (info) => {
      updateStreamingDeltaContent(
        sessionId,
        info,
        actions.setStreamingDeltaContent
      );
    },
  };
}
