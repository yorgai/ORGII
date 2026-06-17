import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "../../types";
import { eventStoreProxy } from "../EventStoreProxy";

const { rpcMock, warnMock } = vi.hoisted(() => ({
  rpcMock: {
    sessionCore: {
      eventStore: {
        append: vi.fn().mockResolvedValue(undefined),
        mergeEvents: vi.fn().mockResolvedValue(undefined),
        replaceAndRemove: vi.fn().mockResolvedValue(true),
        set: vi.fn().mockResolvedValue(undefined),
        upsert: vi.fn().mockResolvedValue(undefined),
        saveToCache: vi.fn().mockResolvedValue(1),
      },
    },
  },
  warnMock: vi.fn(),
}));

vi.mock("@src/api/tauri/rpc", () => ({
  rpc: rpcMock,
}));

// EventStoreProxy logs recoverable failures through the logger facade
// (`createLogger(...).warn`), not raw `console.warn`. The facade binds the
// native console methods at import time, so spying on `console.warn` can't
// observe the call — intercept the facade's `warn` instead.
vi.mock("@src/hooks/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@src/hooks/logger")>();
  return {
    ...actual,
    createLogger: (namespace: string) => ({
      ...actual.createLogger(namespace),
      warn: warnMock,
    }),
  };
});

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

  it("treats cache save failures as non-fatal best-effort sync", async () => {
    warnMock.mockClear();
    rpcMock.sessionCore.eventStore.saveToCache.mockRejectedValueOnce(
      new Error("database is locked")
    );

    await expect(eventStoreProxy.saveToCache("session-a")).resolves.toBe(0);

    expect(rpcMock.sessionCore.eventStore.saveToCache).toHaveBeenCalledWith({
      sessionId: "session-a",
    });
    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining("saveToCache failed"),
      expect.objectContaining({
        sessionId: "session-a",
        error: expect.any(Error),
      })
    );
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
