/**
 * eventBuilders.appendStreamDelta — pendingFlush LRU bound regression
 * tests.
 *
 * Regression target:
 *   `pendingFlush` is a module-level write buffer keyed by stream ID.
 *   Under normal operation the periodic timer drains it every ~16 ms
 *   and the size never grows. But two failure shapes can leave deltas
 *   in the map indefinitely:
 *
 *     1. A subagent / streaming path that pushes deltas without ever
 *        reaching `flushPendingStreamDeltas` (e.g. throws on the next
 *        line after `scheduleFlush`, or the timer is cleared but never
 *        rescheduled).
 *     2. A pathological burst where deltas arrive faster than the
 *        event loop can dispatch `setTimeout(16)`. The map balloons
 *        while the event loop is starved.
 *
 *   Without a bound, both shapes leak SessionEvent instances forever.
 *
 * Fix verified here:
 *   - `pendingFlush` is now a `BoundedMap<string, SessionEvent>` with
 *     a cap of `PENDING_FLUSH_MAX_ENTRIES`. Pushing past the cap
 *     evicts the oldest entry; the eviction callback forwards the
 *     evicted event to `eventStoreProxy.upsert(...)` so user content
 *     is preserved rather than silently dropped.
 *   - `appendStreamDelta` for an existing stream id reuses the slot
 *     (overwrite, not new entry), so a single long-running stream
 *     doesn't ever evict anything.
 *   - Periodic timer drain (`flushPendingStreamDeltas`) clears the
 *     map without firing `onEvict` (we don't want a duplicate upsert
 *     for normal flush paths).
 *
 * Mocks:
 *   - `eventStoreProxy` is stubbed so we can observe `upsert` calls
 *     without touching the real (Tauri-backed) store.
 *   - Timers are faked so we control when the periodic flush fires.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";

import {
  PENDING_FLUSH_MAX_ENTRIES,
  appendStreamDelta,
  flushPendingStreamDeltas,
  getPendingFlushSize,
  resetStreamRefs,
} from "../eventBuilders";
import type { StreamRefs } from "../types";

// Mock the proxy before importing the module under test so the
// module's `import { eventStoreProxy } from "..."` resolves to the
// stub.
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => {
  return {
    eventStoreProxy: {
      upsert: vi.fn(),
      updateById: vi.fn(),
    },
  };
});

function makeRefs(): StreamRefs {
  return {
    idRef: { current: "" },
    contentRef: { current: "" },
  };
}

describe("appendStreamDelta — pendingFlush LRU bound", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Drain anything left over from a previous file's import order.
    flushPendingStreamDeltas();
  });

  afterEach(() => {
    flushPendingStreamDeltas();
    vi.useRealTimers();
  });

  it("normal usage never grows past the cap", () => {
    // Push deltas from many distinct streams without draining the
    // timer; size should ride at PENDING_FLUSH_MAX_ENTRIES.
    const count = PENDING_FLUSH_MAX_ENTRIES + 50;
    for (let i = 0; i < count; i++) {
      const refs = makeRefs();
      appendStreamDelta(refs, "tok", "stream-msg", `session-${i}`, false);
    }
    expect(getPendingFlushSize()).toBeLessThanOrEqual(
      PENDING_FLUSH_MAX_ENTRIES
    );
    expect(getPendingFlushSize()).toBe(PENDING_FLUSH_MAX_ENTRIES);
  });

  it("evicted entries are flushed to eventStoreProxy.upsert (no user data lost)", () => {
    const upsertSpy = vi.mocked(eventStoreProxy.upsert);
    // Fill the buffer to capacity.
    for (let i = 0; i < PENDING_FLUSH_MAX_ENTRIES; i++) {
      const refs = makeRefs();
      appendStreamDelta(refs, "tok", "stream-msg", `session-${i}`, false);
    }
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(getPendingFlushSize()).toBe(PENDING_FLUSH_MAX_ENTRIES);

    // One more new stream → triggers cap-driven eviction of the oldest.
    const overflowRefs = makeRefs();
    appendStreamDelta(
      overflowRefs,
      "tok",
      "stream-msg",
      "session-overflow",
      false
    );

    // Cap is respected.
    expect(getPendingFlushSize()).toBe(PENDING_FLUSH_MAX_ENTRIES);
    // Exactly one eviction → exactly one upsert was forwarded.
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const evictedEvent = upsertSpy.mock.calls[0]?.[0];
    expect(evictedEvent).toBeDefined();
    expect(evictedEvent?.sessionId).toBe("session-0");
  });

  it("repeated deltas on the same stream reuse the slot (no eviction)", () => {
    const upsertSpy = vi.mocked(eventStoreProxy.upsert);
    const refs = makeRefs();
    for (let i = 0; i < PENDING_FLUSH_MAX_ENTRIES * 3; i++) {
      appendStreamDelta(refs, ".", "stream-msg", "single-session", false);
    }
    expect(getPendingFlushSize()).toBe(1);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("flushPendingStreamDeltas drains the map without firing onEvict", () => {
    const upsertSpy = vi.mocked(eventStoreProxy.upsert);
    for (let i = 0; i < 10; i++) {
      const refs = makeRefs();
      appendStreamDelta(refs, "tok", "stream-msg", `session-${i}`, false);
    }
    expect(getPendingFlushSize()).toBe(10);
    flushPendingStreamDeltas();
    expect(getPendingFlushSize()).toBe(0);
    // The normal drain path goes through the for-loop in the function,
    // NOT through onEvict — but it still calls upsert once per entry.
    expect(upsertSpy).toHaveBeenCalledTimes(10);
  });

  it("resetStreamRefs flushes any pending event for the current stream", () => {
    const upsertSpy = vi.mocked(eventStoreProxy.upsert);
    const refs = makeRefs();
    appendStreamDelta(refs, "hello", "stream-msg", "reset-session", false);
    expect(getPendingFlushSize()).toBe(1);
    resetStreamRefs(refs);
    expect(getPendingFlushSize()).toBe(0);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(refs.idRef.current).toBe("");
    expect(refs.contentRef.current).toBe("");
  });

  it("scheduled flush fires after STREAM_FLUSH_INTERVAL_MS", () => {
    const upsertSpy = vi.mocked(eventStoreProxy.upsert);
    const refs = makeRefs();
    appendStreamDelta(refs, "hello", "stream-msg", "timer-session", false);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(getPendingFlushSize()).toBe(1);

    // Advance past the 16ms throttle window.
    vi.advanceTimersByTime(20);
    expect(getPendingFlushSize()).toBe(0);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  it("burst writes followed by drain produce exactly one upsert per stream", () => {
    const upsertSpy = vi.mocked(eventStoreProxy.upsert);
    const refsList = Array.from({ length: 50 }, () => makeRefs());
    for (let i = 0; i < 50; i++) {
      appendStreamDelta(refsList[i], "tok", "stream-msg", `burst-${i}`, false);
    }
    expect(getPendingFlushSize()).toBe(50);
    vi.advanceTimersByTime(20);
    expect(getPendingFlushSize()).toBe(0);
    expect(upsertSpy).toHaveBeenCalledTimes(50);
  });

  it("PENDING_FLUSH_MAX_ENTRIES is a positive integer well above realistic concurrency", () => {
    // Sanity check — if someone lowers the cap to e.g. 1, this test
    // catches the change in code review.
    expect(PENDING_FLUSH_MAX_ENTRIES).toBeGreaterThanOrEqual(100);
    expect(Number.isInteger(PENDING_FLUSH_MAX_ENTRIES)).toBe(true);
  });

  it("cap-driven eviction preserves the most-recently-pushed deltas", () => {
    // Push 5 streams. The oldest must be the one evicted.
    const SMALL = 5;
    // Override is module-level so we can't easily shrink the cap from
    // a test; instead we fill all the way to the real cap, then add
    // SMALL extras and check that exactly SMALL evictions happened in
    // FIFO order.
    const upsertSpy = vi.mocked(eventStoreProxy.upsert);

    for (let i = 0; i < PENDING_FLUSH_MAX_ENTRIES; i++) {
      const refs = makeRefs();
      appendStreamDelta(refs, "tok", "stream-msg", `base-${i}`, false);
    }
    upsertSpy.mockClear();
    for (let i = 0; i < SMALL; i++) {
      const refs = makeRefs();
      appendStreamDelta(refs, "tok", "stream-msg", `overflow-${i}`, false);
    }
    expect(upsertSpy).toHaveBeenCalledTimes(SMALL);
    // First SMALL `base-*` sessions are the ones evicted.
    for (let i = 0; i < SMALL; i++) {
      const call = upsertSpy.mock.calls[i]?.[0];
      expect(call?.sessionId).toBe(`base-${i}`);
    }
  });
});
