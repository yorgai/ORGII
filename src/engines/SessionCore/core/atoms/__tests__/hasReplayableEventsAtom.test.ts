/**
 * hasReplayableEventsAtom
 *
 * Guards the `canReplay` semantics consumed by `useChatEventReplay`.
 *
 * Two properties matter and are both regression-prone:
 *
 *  1. Correctness: it must mirror `sortedEventsAtom.length > 0`, NOT
 *     `eventCount > 0`. The two diverge during live streaming — Rust omits
 *     `sortedSimulatorEvents` from streaming snapshots while `eventCount`
 *     keeps rising, so a `eventCount`-based flag would wrongly report
 *     "replayable" mid-stream (the bug this atom was rewritten to avoid).
 *
 *  2. Cheapness: the boolean output must only flip empty → non-empty, so
 *     subscribers (every chat block via `useChatEventReplay`) do NOT
 *     re-render on each streamed event. We assert jotai's value-equality
 *     bail-out by counting subscriber notifications across appends.
 */
import { createStore } from "jotai/vanilla";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "../../types";
import type {
  derivedSnapshotAtom as DerivedSnapshotAtomType,
  eventCountAtom as EventCountAtomType,
  hasReplayableEventsAtom as HasReplayableEventsAtomType,
  sortedEventsAtom as SortedEventsAtomType,
} from "../events";

// EventStoreProxy pulls in Tauri listeners on import; stub it like the
// sibling actions.test.ts so the atom module can be imported in isolation.
vi.mock("../../store/EventStoreProxy", () => ({
  eventStoreProxy: {
    set: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    mergeEvents: vi.fn().mockResolvedValue(undefined),
    removeSyntheticUserInputEvents: vi.fn().mockResolvedValue(0),
  },
}));

let derivedSnapshotAtom: typeof DerivedSnapshotAtomType;
let sortedEventsAtom: typeof SortedEventsAtomType;
let eventCountAtom: typeof EventCountAtomType;
let hasReplayableEventsAtom: typeof HasReplayableEventsAtomType;

beforeAll(async () => {
  ({
    derivedSnapshotAtom,
    sortedEventsAtom,
    eventCountAtom,
    hasReplayableEventsAtom,
  } = await import("../events"));
});

function makeEvent(id: string): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId: "session-1",
    createdAt: "2026-06-17T00:00:00.000Z",
    functionName: "message",
    uiCanonical: "message",
    actionType: "message",
    args: {},
    result: {},
    source: "assistant",
    displayText: id,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
  } as SessionEvent;
}

/** DerivedSnapshot — carries `sortedSimulatorEvents` (settled session). */
function makeDerivedSnapshot(events: SessionEvent[]) {
  return {
    version: 1,
    eventCount: events.length,
    events,
    chatEvents: events,
    messagesEvents: [],
    sortedSimulatorEvents: events,
    lastEvent: events[events.length - 1] ?? null,
    eventIndex: {},
    chatEventCount: events.length,
    hasRunningEvent: false,
  };
}

/**
 * StreamingSnapshot — `sortedSimulatorEvents` is OMITTED during live
 * streaming for performance, while `eventCount` still reflects the real
 * number of events written. This is the case where eventCount-based and
 * sortedEvents-based flags diverge.
 */
function makeStreamingSnapshotWithoutSorted(eventCount: number) {
  return {
    version: 2,
    eventCount,
    chatEvents: [],
    lastEvent: null,
    streaming: true,
    hasRunningEvent: true,
  };
}

describe("hasReplayableEventsAtom", () => {
  it("is false with no snapshot loaded", () => {
    const store = createStore();
    expect(store.get(hasReplayableEventsAtom)).toBe(false);
  });

  it("is false for an empty derived snapshot", () => {
    const store = createStore();
    store.set(derivedSnapshotAtom, makeDerivedSnapshot([]) as never);
    expect(store.get(hasReplayableEventsAtom)).toBe(false);
  });

  it("is true once a derived snapshot carries events", () => {
    const store = createStore();
    store.set(
      derivedSnapshotAtom,
      makeDerivedSnapshot([makeEvent("e1")]) as never
    );
    expect(store.get(hasReplayableEventsAtom)).toBe(true);
  });

  it("stays false mid-stream when sortedSimulatorEvents is omitted even though eventCount > 0", () => {
    const store = createStore();
    store.set(
      derivedSnapshotAtom,
      makeStreamingSnapshotWithoutSorted(5) as never
    );

    // The regression guard: eventCount diverges from replayability.
    expect(store.get(eventCountAtom)).toBe(5);
    expect(store.get(sortedEventsAtom)).toHaveLength(0);
    expect(store.get(hasReplayableEventsAtom)).toBe(false);
  });

  it("flips to true exactly once and does not notify subscribers on further appends", () => {
    const store = createStore();
    const notify = vi.fn();
    const unsub = store.sub(hasReplayableEventsAtom, notify);

    // Empty → still false, subscriber should not fire for a no-op flip.
    store.set(derivedSnapshotAtom, makeDerivedSnapshot([]) as never);
    expect(store.get(hasReplayableEventsAtom)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(0);

    // First real event → flips false → true (one notification).
    store.set(
      derivedSnapshotAtom,
      makeDerivedSnapshot([makeEvent("e1")]) as never
    );
    expect(store.get(hasReplayableEventsAtom)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);

    // Subsequent appends keep the boolean `true`; jotai's value-equality
    // bail-out means NO further subscriber notifications (no re-render storm).
    store.set(
      derivedSnapshotAtom,
      makeDerivedSnapshot([makeEvent("e1"), makeEvent("e2")]) as never
    );
    store.set(
      derivedSnapshotAtom,
      makeDerivedSnapshot([
        makeEvent("e1"),
        makeEvent("e2"),
        makeEvent("e3"),
      ]) as never
    );
    expect(store.get(hasReplayableEventsAtom)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);

    unsub();
  });
});
