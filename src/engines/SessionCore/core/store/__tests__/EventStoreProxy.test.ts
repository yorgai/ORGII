import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "../../types";
import { eventStoreProxy } from "../EventStoreProxy";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: {
    sessionCore: {
      eventStore: {
        append: vi.fn().mockResolvedValue(undefined),
        mergeEvents: vi.fn().mockResolvedValue(undefined),
        replaceAndRemove: vi.fn().mockResolvedValue(true),
        set: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

vi.mock("@src/api/tauri/rpc", () => ({
  rpc: rpcMock,
}));

describe("EventStoreProxy session targeting", () => {
  it("infers the target session from an upserted event", async () => {
    const event = makeEvent("event-1", "session-a");

    await eventStoreProxy.upsert(event);

    expect(rpcMock.sessionCore.eventStore.upsert).toHaveBeenCalledWith({
      event,
      sessionId: "session-a",
    });
  });

  it("infers the target session from same-session append events", async () => {
    const events = [makeEvent("event-1", "session-b")];

    await eventStoreProxy.append(events);

    expect(rpcMock.sessionCore.eventStore.append).toHaveBeenCalledWith({
      events,
      sessionId: "session-b",
    });
  });

  it("does not infer a mixed-session batch", async () => {
    const events = [
      makeEvent("event-1", "session-a"),
      makeEvent("event-2", "session-b"),
    ];

    await eventStoreProxy.mergeEvents(events);

    expect(rpcMock.sessionCore.eventStore.mergeEvents).toHaveBeenCalledWith({
      events,
      sessionId: null,
    });
  });
});

function makeEvent(id: string, sessionId: string): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId,
    createdAt: "2026-05-16T00:00:00.000Z",
    functionName: "assistant_message",
    uiCanonical: "message",
    actionType: "assistant",
    args: {},
    result: { observation: id },
    source: "assistant",
    displayText: id,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
  };
}
