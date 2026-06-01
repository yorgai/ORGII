import { Message } from "@src/components/Message";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { Logger } from "@src/hooks/logger";

import type { SessionLoadStateActions } from "./sessionSyncStateHelpers";
import {
  hydrateSessionStoreBeforeDisplay,
  loadOwnSessionInitialEvents,
} from "./sessionSyncUtils";

export function loadSessionWithoutAdapter(
  sessionId: string,
  abortController: AbortController,
  actions: Pick<
    SessionLoadStateActions,
    | "dispatchLoadSession"
    | "failSessionLoad"
    | "setLoadStatus"
    | "setWpReadOnly"
  >,
  logger: Logger
): void {
  const loadHistory = async () => {
    actions.setLoadStatus("loading");
    try {
      await eventStoreProxy.switchSession(sessionId);
      if (abortController.signal.aborted) return;
      const events = await loadOwnSessionInitialEvents(sessionId);
      if (abortController.signal.aborted) return;
      await hydrateSessionStoreBeforeDisplay(sessionId, events);
      if (abortController.signal.aborted) return;
      actions.dispatchLoadSession({ sessionId, events });
      actions.setWpReadOnly(true);
    } catch (error) {
      if (abortController.signal.aborted) return;
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`failed to load session (no adapter) ${sessionId}:`, error);
      actions.failSessionLoad(detail);
      actions.setWpReadOnly(true);
      Message.error({
        content: `Failed to load session history: ${detail}`,
        duration: 5000,
      });
    }
  };

  void loadHistory();
}
