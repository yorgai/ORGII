import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  derivedSnapshotAtom,
  streamingDeltaContentAtom,
} from "@src/engines/SessionCore/core/atoms/events";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms/metadata";
import { chatEventsAtom } from "@src/engines/SessionCore/derived/chatEvents";

function setLiveContent(
  store: ReturnType<typeof createStore>,
  sessionId: string,
  content: string
) {
  store.set(streamingDeltaContentAtom, new Map([[sessionId, content]]));
}

describe("chatEventsAtom live streaming overlay", () => {
  it("renders live assistant text without writing a durable EventStore event", () => {
    const store = createStore();
    store.set(sessionIdAtom, "session-1");
    store.set(derivedSnapshotAtom, {
      version: 1,
      eventCount: 0,
      events: [],
      chatEvents: [],
      messagesEvents: [],
      sortedSimulatorEvents: [],
      lastEvent: null,
      eventIndex: {},
      chatEventCount: 0,
      hasRunningEvent: false,
    });

    setLiveContent(store, "session-1", "hello live");

    expect(store.get(chatEventsAtom)).toEqual([
      expect.objectContaining({
        id: "live-assistant-session-1",
        sessionId: "session-1",
        functionName: "assistant_message",
        displayText: "hello live",
        displayStatus: "running",
        isDelta: true,
      }),
    ]);
  });
});
