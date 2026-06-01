import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { loadTurnBody } from "@src/engines/SessionCore/storage/cacheAdapter";

import type { SessionTurnLoader } from "./types";

export const ownDbTurnLoader: SessionTurnLoader = {
  async loadTurnBodyIntoStore({ sessionId, turnId }) {
    const turnWindow = await loadTurnBody(sessionId, turnId);
    if (turnWindow.events.length === 0) return;

    await eventStoreProxy.mergeRoundWindowEvents(turnWindow.events, sessionId);
  },
};
