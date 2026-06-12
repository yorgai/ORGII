import { rpc } from "@src/api/tauri/rpc";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type {
  AdapterSendInput,
  EventHandlerCallbacks,
  SessionAdapter,
  SessionEventHandler,
} from "../types";

function createNoopEventHandler(): SessionEventHandler {
  return {
    handleEvent(): void {},
    reset(): void {},
    get isStreaming() {
      return false;
    },
    dispose(): void {},
  };
}

async function loadRemoteSharedSession(
  sessionId: string,
  signal: AbortSignal
): Promise<SessionEvent[]> {
  const events = await rpc.sessionCore.eventStore.getEvents({ sessionId });
  if (signal.aborted) return [];
  return events;
}

export const remoteSharedSessionAdapter: SessionAdapter = {
  category: "remote_shared_session",

  loadHistory: loadRemoteSharedSession,

  async postLoad() {
    return { runStatus: "completed" };
  },

  createEventHandler(
    _sessionId: string,
    _callbacks: EventHandlerCallbacks
  ): SessionEventHandler {
    return createNoopEventHandler();
  },

  async sendMessage(input: AdapterSendInput): Promise<void> {
    throw new Error(
      `Shared sessions are read-only and cannot receive agent messages (${input.sessionId}).`
    );
  },

  async stopSession(): Promise<void> {},
};
