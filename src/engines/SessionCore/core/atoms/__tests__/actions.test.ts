import { createStore } from "jotai/vanilla";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "../../types";
import type { loadSessionAtom as LoadSessionAtomType } from "../actions";
import type { eventsAtom as EventsAtomType } from "../events";

vi.mock("../../store/EventStoreProxy", () => ({
  eventStoreProxy: {
    mergeEvents: vi.fn().mockResolvedValue(undefined),
  },
}));

const localStorageStore = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => localStorageStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageStore.set(key, value);
  },
  removeItem: (key: string) => {
    localStorageStore.delete(key);
  },
  clear: () => {
    localStorageStore.clear();
  },
});

let loadSessionAtom: typeof LoadSessionAtomType;
let eventsAtom: typeof EventsAtomType;

beforeAll(async () => {
  ({ loadSessionAtom } = await import("../actions"));
  ({ eventsAtom } = await import("../events"));
});

function makeMessageEvent(
  id: string,
  sessionId = "session-1",
  createdAt = "2026-05-16T00:00:00.000Z"
): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId,
    createdAt,
    functionName: "message",
    uiCanonical: "message",
    actionType: "message",
    args: {},
    result: {},
    source: id.startsWith("user") ? "user" : "assistant",
    displayText: id,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
  };
}

describe("loadSessionAtom", () => {
  it("preserves existing same-session rounds when a later load carries only a new tail event", () => {
    const store = createStore();
    const existingEvents = [
      makeMessageEvent("user-round-1", "session-1", "2026-05-16T00:00:01.000Z"),
      makeMessageEvent(
        "assistant-round-1",
        "session-1",
        "2026-05-16T00:00:02.000Z"
      ),
      makeMessageEvent("user-round-2", "session-1", "2026-05-16T00:00:03.000Z"),
      makeMessageEvent(
        "assistant-round-2",
        "session-1",
        "2026-05-16T00:00:04.000Z"
      ),
      makeMessageEvent("user-round-3", "session-1", "2026-05-16T00:00:05.000Z"),
    ];
    const followup = makeMessageEvent(
      "user-round-4",
      "session-1",
      "2026-05-16T00:00:06.000Z"
    );

    store.set(loadSessionAtom, {
      sessionId: "session-1",
      events: existingEvents,
    });
    store.set(loadSessionAtom, { sessionId: "session-1", events: [followup] });

    expect(store.get(eventsAtom).map((event) => event.id)).toEqual([
      "user-round-1",
      "assistant-round-1",
      "user-round-2",
      "assistant-round-2",
      "user-round-3",
      "user-round-4",
    ]);
  });

  it("preserves existing same-session history when a later load has equal or more events", () => {
    const store = createStore();
    const existingEvents = [
      makeMessageEvent("user-round-1", "session-1", "2026-05-16T00:00:01.000Z"),
      makeMessageEvent(
        "assistant-round-1",
        "session-1",
        "2026-05-16T00:00:02.000Z"
      ),
    ];
    const nextEvents = [
      makeMessageEvent("user-round-2", "session-1", "2026-05-16T00:00:03.000Z"),
      makeMessageEvent(
        "assistant-round-2",
        "session-1",
        "2026-05-16T00:00:04.000Z"
      ),
    ];

    store.set(loadSessionAtom, {
      sessionId: "session-1",
      events: existingEvents,
    });
    store.set(loadSessionAtom, { sessionId: "session-1", events: nextEvents });

    expect(store.get(eventsAtom).map((event) => event.id)).toEqual([
      "user-round-1",
      "assistant-round-1",
      "user-round-2",
      "assistant-round-2",
    ]);
  });

  it("replaces events when switching to a different session", () => {
    const store = createStore();
    const sessionOneEvents = [makeMessageEvent("user-round-1", "session-1")];
    const sessionTwoEvents = [makeMessageEvent("user-round-1", "session-2")];

    store.set(loadSessionAtom, {
      sessionId: "session-1",
      events: sessionOneEvents,
    });
    store.set(loadSessionAtom, {
      sessionId: "session-2",
      events: sessionTwoEvents,
    });

    expect(store.get(eventsAtom).map((event) => event.sessionId)).toEqual([
      "session-2",
    ]);
  });
});
