import type { SessionEvent } from "@src/engines/SessionCore";

import { mergeSessionEventsToolResultsByCallId } from "../mergeSessionEventsToolResultsByCallId";

function makeEvent(
  overrides: Partial<SessionEvent> & Pick<SessionEvent, "id" | "createdAt">
): SessionEvent {
  return {
    chunk_id: null,
    sessionId: "session-id",
    actionType: "tool_call",
    functionName: "do_thing",
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

describe("mergeSessionEventsToolResultsByCallId — lastActivityAt", () => {
  it("stamps lastActivityAt with the group's max createdAt", () => {
    const events: SessionEvent[] = [
      makeEvent({
        id: "call",
        createdAt: "2025-01-01T00:00:00Z",
        actionType: "tool_call",
        args: { call_id: "c1" },
      }),
      makeEvent({
        id: "result",
        createdAt: "2025-01-01T00:00:02Z",
        actionType: "tool_result",
        result: { call_id: "c1", content: "done" },
      }),
    ];

    const merged = mergeSessionEventsToolResultsByCallId(events) as Array<
      SessionEvent & { lastActivityAt?: string }
    >;

    expect(merged).toHaveLength(2);
    // The tool_call (earlier) gets stamped with the group's max activity
    // timestamp — that's the bridge the cursor crosses to see the tool
    // result's completion time at the final frame.
    expect(merged[0].lastActivityAt).toBe("2025-01-01T00:00:02Z");
    // The result event already has the max timestamp on its createdAt, so
    // the additive lastActivityAt is omitted (no need to duplicate).
    expect(merged[1].lastActivityAt).toBeUndefined();
    // createdAt is left untouched (any ordering consumer is unaffected).
    expect(merged[0].createdAt).toBe("2025-01-01T00:00:00Z");
    expect(merged[1].createdAt).toBe("2025-01-01T00:00:02Z");
  });

  it("does not add lastActivityAt when the group has only one timestamp", () => {
    const events: SessionEvent[] = [
      makeEvent({
        id: "solo",
        createdAt: "2025-01-01T00:00:00Z",
        args: { call_id: "c1" },
      }),
    ];

    const merged = mergeSessionEventsToolResultsByCallId(events) as Array<
      SessionEvent & { lastActivityAt?: string }
    >;

    expect(merged[0].lastActivityAt).toBeUndefined();
  });

  it("leaves events without a call id untouched", () => {
    const events: SessionEvent[] = [
      makeEvent({
        id: "assistant",
        createdAt: "2025-01-01T00:00:00Z",
        actionType: "assistant",
      }),
    ];

    const merged = mergeSessionEventsToolResultsByCallId(events) as Array<
      SessionEvent & { lastActivityAt?: string }
    >;

    expect(merged[0].lastActivityAt).toBeUndefined();
    expect(merged[0]).toEqual(events[0]);
  });
});
