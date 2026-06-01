import { type SessionStatus, updateSessionStatus } from "@src/store/session";

import {
  type SessionLoadStateActions,
  applyPostLoadResult,
} from "./sessionSyncStateHelpers";
import type { SessionSyncRefs } from "./sessionSyncTypes";
import {
  IN_FLIGHT_HISTORY_RECONCILE_DELAYS_MS,
  hydrateSessionStoreBeforeDisplay,
  isTerminalRunStatus,
  loadPersistedHistory,
  toCliSessionStatus,
  waitForReconcileDelay,
} from "./sessionSyncUtils";
import type { SessionAdapter } from "./types";

export function reconcileInFlightHistory(
  sessionId: string,
  adapter: SessionAdapter,
  refs: Pick<SessionSyncRefs, "liveSessionIdRef">,
  actions: Pick<
    SessionLoadStateActions,
    | "dispatchLoadSession"
    | "setSessionContextTokens"
    | "setSessionRuntimeStatus"
    | "setSessionRuntimeError"
  >
): void {
  const reconcile = async () => {
    const reconcileController = new AbortController();
    for (const delayMs of IN_FLIGHT_HISTORY_RECONCILE_DELAYS_MS) {
      await waitForReconcileDelay(delayMs);
      if (refs.liveSessionIdRef.current !== sessionId) return;

      const postResult = adapter.postLoad
        ? await adapter.postLoad(sessionId, reconcileController.signal)
        : null;
      if (refs.liveSessionIdRef.current !== sessionId) return;

      const persistedEvents = await loadPersistedHistory(
        adapter,
        sessionId,
        reconcileController.signal
      );
      if (
        refs.liveSessionIdRef.current !== sessionId ||
        persistedEvents.length === 0
      ) {
        continue;
      }

      await hydrateSessionStoreBeforeDisplay(
        sessionId,
        persistedEvents,
        "merge"
      );
      if (refs.liveSessionIdRef.current !== sessionId) return;
      actions.dispatchLoadSession({ sessionId, events: persistedEvents });

      if (postResult?.contextTokens !== undefined) {
        actions.setSessionContextTokens(postResult.contextTokens);
      }
      if (postResult?.runStatus !== undefined) {
        actions.setSessionRuntimeStatus(
          toCliSessionStatus(postResult.runStatus)
        );
        updateSessionStatus(sessionId, postResult.runStatus as SessionStatus);
        if (isTerminalRunStatus(postResult.runStatus)) return;
      }
      if (postResult?.runError !== undefined) {
        actions.setSessionRuntimeError(postResult.runError);
      }
    }
  };

  void reconcile();
}

export function applySwitchPostLoadResult(
  sessionId: string,
  postResult: Parameters<typeof applyPostLoadResult>[1],
  actions: Pick<
    SessionLoadStateActions,
    | "setSessionContextTokens"
    | "setSessionRuntimeStatus"
    | "setSessionRuntimeError"
  >
): void {
  applyPostLoadResult(sessionId, postResult, actions);
}
