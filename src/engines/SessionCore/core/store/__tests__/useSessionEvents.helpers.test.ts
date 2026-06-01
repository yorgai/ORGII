/**
 * Unit tests for the pure helpers backing `useSessionEvents`.
 *
 * The hook itself is a thin orchestration layer over jotai atoms +
 * a Tauri-backed event store; testing it end-to-end would require
 * a full React renderer with mocked Tauri RPC. The two helpers we
 * test here are exhaustively pure:
 *
 *   - `extractChatEvents(snapshot)` — picks the right `chatEvents`
 *     field off either snapshot variant. Was previously a local
 *     function inside the hook; promoted to `export` so we can
 *     pin its behaviour.
 *   - `normalizeSessionEventsError(err)` — turns an arbitrary
 *     thrown value into a uniform `Error`. Replaces the previous
 *     `catch (_err)` that silently swallowed the rejection.
 *
 * Coverage:
 *   - StreamingSnapshot and DerivedSnapshot both surface their
 *     `chatEvents` field correctly.
 *   - `isStreamingSnapshot` discrimination is forwarded.
 *   - Error normalisation: Error instance, string, object, primitive,
 *     circular reference (JSON-fallback path).
 */
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../../types";
import type { DerivedSnapshot, StreamingSnapshot } from "../EventStoreProxy";
import {
  extractChatEvents,
  normalizeSessionEventsError,
} from "../useSessionEvents";

function makeEvent(id: string, sessionId = "s1"): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId,
    createdAt: "2025-01-01T00:00:00Z",
    functionName: "noop",
    uiCanonical: "",
    actionType: "noop" as SessionEvent["actionType"],
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    isDelta: false,
  };
}

function makeDerivedSnapshot(chatEvents: SessionEvent[]): DerivedSnapshot {
  return {
    version: 1,
    eventCount: chatEvents.length,
    events: chatEvents,
    chatEvents,
    messagesEvents: [],
    sortedSimulatorEvents: chatEvents,
    lastEvent: chatEvents[chatEvents.length - 1] ?? null,
    eventIndex: {},
    chatEventCount: chatEvents.length,
    hasRunningEvent: false,
  };
}

function makeStreamingSnapshot(chatEvents: SessionEvent[]): StreamingSnapshot {
  return {
    version: 1,
    eventCount: chatEvents.length,
    chatEvents,
    sortedSimulatorEvents: chatEvents,
    lastEvent: chatEvents[chatEvents.length - 1] ?? null,
    streaming: true,
    hasRunningEvent: true,
  };
}

describe("extractChatEvents", () => {
  it("returns chatEvents from a DerivedSnapshot", () => {
    const events = [makeEvent("a"), makeEvent("b")];
    const snap = makeDerivedSnapshot(events);
    expect(extractChatEvents(snap)).toEqual(events);
  });

  it("returns chatEvents from a StreamingSnapshot", () => {
    const events = [makeEvent("x"), makeEvent("y"), makeEvent("z")];
    const snap = makeStreamingSnapshot(events);
    expect(extractChatEvents(snap)).toEqual(events);
  });

  it("returns the chatEvents reference identity (no shallow copy)", () => {
    const events = [makeEvent("a")];
    const snap = makeDerivedSnapshot(events);
    expect(extractChatEvents(snap)).toBe(events);
  });

  it("handles an empty chatEvents list", () => {
    expect(extractChatEvents(makeDerivedSnapshot([]))).toEqual([]);
    expect(extractChatEvents(makeStreamingSnapshot([]))).toEqual([]);
  });

  it("DerivedSnapshot without `streaming` flag is treated as derived (not streaming)", () => {
    // Belt-and-suspenders: a snapshot with `streaming: false`
    // explicitly set should still hit the derived branch.
    const events = [makeEvent("a")];
    const ambiguous = {
      ...makeDerivedSnapshot(events),
      streaming: false,
    } as DerivedSnapshot;
    expect(extractChatEvents(ambiguous)).toEqual(events);
  });
});

describe("normalizeSessionEventsError", () => {
  it("returns the same instance for Error", () => {
    const e = new Error("oops");
    expect(normalizeSessionEventsError(e)).toBe(e);
  });

  it("preserves the prototype chain for Error subclasses", () => {
    class CustomError extends Error {}
    const e = new CustomError("custom");
    const normalized = normalizeSessionEventsError(e);
    expect(normalized).toBe(e);
    expect(normalized).toBeInstanceOf(CustomError);
  });

  it("wraps a string in a new Error with the string as message", () => {
    const e = normalizeSessionEventsError("plain string rejection");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("plain string rejection");
  });

  it("wraps a plain object using JSON.stringify", () => {
    const e = normalizeSessionEventsError({ code: 42, detail: "fail" });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain("42");
    expect(e.message).toContain("fail");
  });

  it("handles a primitive number / boolean / null", () => {
    expect(normalizeSessionEventsError(42).message).toBe("42");
    expect(normalizeSessionEventsError(true).message).toBe("true");
    expect(normalizeSessionEventsError(null).message).toBe("null");
  });

  it("falls back to 'unknown error' on JSON.stringify failure (circular ref)", () => {
    type Cyclic = { self?: Cyclic };
    const cyclic: Cyclic = {};
    cyclic.self = cyclic;
    const e = normalizeSessionEventsError(cyclic);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("unknown error");
  });

  it("always returns a real Error so consumers can `instanceof Error`", () => {
    const cases: unknown[] = [undefined, 0, "", [], {}, Symbol("x")];
    for (const c of cases) {
      const e = normalizeSessionEventsError(c);
      expect(e).toBeInstanceOf(Error);
      expect(typeof e.message).toBe("string");
    }
  });
});
