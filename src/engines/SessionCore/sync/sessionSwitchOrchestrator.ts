import { cursorBridgeComposerLastUpdatedAt } from "@src/api/tauri/cursorBridge";
import { Message } from "@src/components/Message";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { isVisibleInChat } from "@src/engines/SessionCore/ingestion/visibilityFilters";
import type { Logger } from "@src/hooks/logger";
import {
  composerIdFromSessionId,
  isImportedHistorySession,
} from "@src/util/session/sessionDispatch";

import { getCursorIdeSnapshotLastUpdatedAt } from "./adapters/cursorIdeAdapter";
import { isCursorIdeSessionId } from "./sessionSyncDerivedState";
import { rehydratePendingPlanApproval } from "./sessionSyncPlanApproval";
import { reconcileInFlightHistory } from "./sessionSyncReconcile";
import {
  type SessionLoadStateActions,
  appendRecoveredEvents,
  applyPostLoadResult,
} from "./sessionSyncStateHelpers";
import type {
  CheckAndRecoverSession,
  SessionSyncRefs,
} from "./sessionSyncTypes";
import {
  hydrateSessionStoreBeforeDisplay,
  isInFlightRunStatus,
  loadPersistedHistory,
} from "./sessionSyncUtils";
import type { SessionAdapter } from "./types";

interface SessionSwitchOrchestratorOptions {
  sessionId: string;
  adapter: SessionAdapter;
  abortController: AbortController;
  refs: Pick<SessionSyncRefs, "liveSessionIdRef">;
  actions: SessionLoadStateActions;
  checkAndRecover: CheckAndRecoverSession;
  setPendingPlanApprovals: Parameters<typeof rehydratePendingPlanApproval>[2];
  logger: Logger;
}

export function runSessionSwitchOrchestrator(
  options: SessionSwitchOrchestratorOptions
): void {
  const switchSession = async () => {
    const {
      sessionId,
      adapter,
      abortController,
      refs,
      actions,
      checkAndRecover,
      setPendingPlanApprovals,
    } = options;

    try {
      const cacheHit = await eventStoreProxy.switchSession(sessionId);
      if (abortController.signal.aborted) return;
      if (cacheHit) {
        await handleCacheHit({
          sessionId,
          adapter,
          abortController,
          refs,
          actions,
          setPendingPlanApprovals,
        });
        return;
      }

      await handleCacheMiss({
        sessionId,
        adapter,
        abortController,
        refs,
        actions,
        checkAndRecover,
        setPendingPlanApprovals,
      });
    } catch (error) {
      if (!options.abortController.signal.aborted) {
        const detail = error instanceof Error ? error.message : String(error);
        options.logger.error(
          `failed to load history for ${options.sessionId}:`,
          error
        );
        options.actions.failSessionLoad(detail);
        Message.error({
          content: `Failed to load session history: ${detail}`,
          duration: 5000,
        });
      }
    }
  };

  void switchSession();
}

async function handleCacheHit(
  options: Pick<
    SessionSwitchOrchestratorOptions,
    | "sessionId"
    | "adapter"
    | "abortController"
    | "refs"
    | "actions"
    | "setPendingPlanApprovals"
  >
): Promise<void> {
  const {
    sessionId,
    adapter,
    abortController,
    refs,
    actions,
    setPendingPlanApprovals,
  } = options;

  if (isCursorIdeSessionId(sessionId)) {
    const handled = await handleCursorIdeCacheHit(
      sessionId,
      adapter,
      abortController,
      actions
    );
    if (handled) return;
  }

  actions.setLoadStatus("loading");

  const postResult = adapter.postLoad
    ? await adapter.postLoad(sessionId, abortController.signal)
    : null;
  if (abortController.signal.aborted) return;

  const cacheHitInFlight = isInFlightRunStatus(postResult?.runStatus);
  let displayEvents = await eventStoreProxy.getEvents(sessionId);
  if (abortController.signal.aborted) return;

  if (!cacheHitInFlight) {
    if (adapter.category === "agent") {
      await eventStoreProxy.loadInitialTurnWindow(sessionId);
      if (abortController.signal.aborted) return;
      displayEvents = await eventStoreProxy.getEvents(sessionId);
    } else if (
      displayEvents.length === 0 ||
      !displayEvents.some(isVisibleInChat)
    ) {
      displayEvents = await loadPersistedHistory(
        adapter,
        sessionId,
        abortController.signal
      );
      if (abortController.signal.aborted) return;
      await hydrateSessionStoreBeforeDisplay(sessionId, displayEvents);
    }
    if (abortController.signal.aborted) return;
  }

  actions.dispatchLoadSession({
    sessionId,
    events: displayEvents,
    isFromCache: true,
  });
  rehydratePendingPlanApproval(
    sessionId,
    abortController,
    setPendingPlanApprovals
  );
  if (!isImportedHistorySession(sessionId)) {
    reconcileInFlightHistory(sessionId, adapter, refs, actions);
  }
  applyPostLoadResult(sessionId, postResult, actions);
}

async function handleCursorIdeCacheHit(
  sessionId: string,
  adapter: SessionAdapter,
  abortController: AbortController,
  actions: Pick<
    SessionLoadStateActions,
    "dispatchLoadSession" | "setLoadStatus"
  >
): Promise<boolean> {
  actions.setLoadStatus("loading");
  const composerId = composerIdFromSessionId(sessionId);
  const currentUpdatedAt = composerId
    ? await cursorBridgeComposerLastUpdatedAt(composerId)
    : null;
  if (abortController.signal.aborted) return true;
  const cachedUpdatedAt = getCursorIdeSnapshotLastUpdatedAt(sessionId);
  if (currentUpdatedAt !== null && cachedUpdatedAt === currentUpdatedAt) {
    const cachedEvents = await eventStoreProxy.getEvents();
    if (abortController.signal.aborted) return true;
    actions.dispatchLoadSession({ sessionId, events: cachedEvents });
    return true;
  }

  const events = await adapter.loadHistory(sessionId, abortController.signal);
  if (abortController.signal.aborted) return true;
  await eventStoreProxy.set(events, sessionId);
  if (abortController.signal.aborted) return true;
  actions.dispatchLoadSession({ sessionId, events });
  return true;
}

async function handleCacheMiss(
  options: Pick<
    SessionSwitchOrchestratorOptions,
    | "sessionId"
    | "adapter"
    | "abortController"
    | "refs"
    | "actions"
    | "checkAndRecover"
    | "setPendingPlanApprovals"
  >
): Promise<void> {
  const {
    sessionId,
    adapter,
    abortController,
    refs,
    actions,
    checkAndRecover,
    setPendingPlanApprovals,
  } = options;

  actions.setLoadStatus("loading");

  const missPostResult = adapter.postLoad
    ? await adapter.postLoad(sessionId, abortController.signal)
    : null;
  if (abortController.signal.aborted) return;

  const missInFlight = isInFlightRunStatus(missPostResult?.runStatus);
  const events = !missInFlight
    ? await loadPersistedHistory(adapter, sessionId, abortController.signal)
    : await adapter.loadHistory(sessionId, abortController.signal);
  if (abortController.signal.aborted) return;
  await hydrateSessionStoreBeforeDisplay(
    sessionId,
    events,
    missInFlight ? "merge" : "replace"
  );
  if (abortController.signal.aborted) return;

  actions.dispatchLoadSession({ sessionId, events });
  if (!isImportedHistorySession(sessionId)) {
    reconcileInFlightHistory(sessionId, adapter, refs, actions);
  }

  applyPostLoadResult(sessionId, missPostResult, actions);

  const recovery = await checkAndRecover(sessionId);
  if (abortController.signal.aborted) return;
  if (recovery.found) {
    appendRecoveredEvents(recovery.recoveredEvents, actions.setEvents);
  }

  rehydratePendingPlanApproval(
    sessionId,
    abortController,
    setPendingPlanApprovals
  );
}
