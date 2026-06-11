import type { SessionEvent } from "@src/engines/SessionCore";

import { eventReplayTimeMs, findIndexAtTime } from "../findIndexAtTime";

function makeSessionEvent(
  overrides: Partial<SessionEvent> & Pick<SessionEvent, "createdAt">
): SessionEvent {
  return {
    chunk_id: null,
    id: `event-${overrides.createdAt}`,
    sessionId: "session-id",
    actionType: "tool_call",
    functionName: "anything",
    uiCanonical: "",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    ...overrides,
  };
}

function eventsAt(...isoTimes: string[]): SessionEvent[] {
  return isoTimes.map((createdAt) => makeSessionEvent({ createdAt }));
}

const T0 = Date.parse("2025-01-01T00:00:00Z");
const T1 = Date.parse("2025-01-01T00:00:01Z");
const T2 = Date.parse("2025-01-01T00:00:02Z");
const T3 = Date.parse("2025-01-01T00:00:03Z");

describe("findIndexAtTime", () => {
  it("returns -1 for empty arrays", () => {
    expect(findIndexAtTime([], 0)).toBe(-1);
    expect(findIndexAtTime([], 0, { preStart: "empty" })).toBe(-1);
  });

  it("clamps cursor-before-first to 0 by default", () => {
    const events = eventsAt("2025-01-01T00:00:01Z", "2025-01-01T00:00:02Z");
    expect(findIndexAtTime(events, T0)).toBe(0);
    expect(findIndexAtTime(events, T0, { preStart: "clamp" })).toBe(0);
  });

  it("returns -1 for cursor-before-first when preStart=empty", () => {
    const events = eventsAt("2025-01-01T00:00:01Z", "2025-01-01T00:00:02Z");
    expect(findIndexAtTime(events, T0, { preStart: "empty" })).toBe(-1);
  });

  it("returns the last index when cursor is past the tail", () => {
    const events = eventsAt(
      "2025-01-01T00:00:00Z",
      "2025-01-01T00:00:01Z",
      "2025-01-01T00:00:02Z"
    );
    expect(findIndexAtTime(events, T3)).toBe(2);
  });

  it("returns the largest index whose timestamp ≤ cursor", () => {
    const events = eventsAt(
      "2025-01-01T00:00:00Z",
      "2025-01-01T00:00:01Z",
      "2025-01-01T00:00:02Z"
    );
    expect(findIndexAtTime(events, T1)).toBe(1);
    expect(findIndexAtTime(events, T1 + 500)).toBe(1);
    expect(findIndexAtTime(events, T2)).toBe(2);
  });

  it("uses lastActivityAt when present (fixes blank final frame)", () => {
    // Tool call started at T0 but the merged result completed at T2. A
    // cursor at T2 must select this event — not fall through to a slice
    // earlier than the call.
    const events: SessionEvent[] = [
      Object.assign(makeSessionEvent({ createdAt: "2025-01-01T00:00:00Z" }), {
        lastActivityAt: "2025-01-01T00:00:02Z",
      }),
    ];
    expect(findIndexAtTime(events, T2)).toBe(0);
    expect(eventReplayTimeMs(events[0])).toBe(T2);
  });

  it("skips non-finite timestamps without poisoning the search", () => {
    const events: SessionEvent[] = [
      makeSessionEvent({ createdAt: "2025-01-01T00:00:00Z" }),
      makeSessionEvent({ createdAt: "not-a-date" }),
      makeSessionEvent({ createdAt: "2025-01-01T00:00:02Z" }),
    ];
    // The corrupt middle entry must not prevent us from finding index 0.
    expect(findIndexAtTime(events, T0)).toBe(0);
    expect(findIndexAtTime(events, T2)).toBe(2);
  });
});

describe("eventReplayTimeMs", () => {
  it("falls back to createdAt when lastActivityAt is missing", () => {
    const event = makeSessionEvent({ createdAt: "2025-01-01T00:00:01Z" });
    expect(eventReplayTimeMs(event)).toBe(T1);
  });

  it("prefers lastActivityAt over createdAt", () => {
    const event = Object.assign(
      makeSessionEvent({ createdAt: "2025-01-01T00:00:00Z" }),
      { lastActivityAt: "2025-01-01T00:00:02Z" }
    );
    expect(eventReplayTimeMs(event)).toBe(T2);
  });
});
