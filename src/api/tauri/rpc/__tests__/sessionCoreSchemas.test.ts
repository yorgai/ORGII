import { describe, expect, it } from "vitest";

import { SessionEventArraySchema } from "../schemas/sessionCore";

describe("sessionCore RPC schemas", () => {
  it("normalizes legacy string result values instead of rejecting history loads", () => {
    const parsed = SessionEventArraySchema.parse([
      makeEvent("event-1", "first message", "2026-05-16T00:00:00.000Z"),
      makeEvent(
        "event-2",
        { content: "second message" },
        "2026-05-16T00:00:01.000Z"
      ),
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].result).toEqual({
      content: "first message",
      observation: "first message",
    });
    expect(parsed[1].result).toEqual({ content: "second message" });
  });
});

function makeEvent(
  id: string,
  result: unknown,
  createdAt: string
): Record<string, unknown> {
  return {
    chunk_id: null,
    id,
    sessionId: "session-history-regression",
    createdAt,
    functionName: "message",
    uiCanonical: "message",
    actionType: "message",
    args: {},
    result,
    source: "assistant",
    displayText: id,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
  };
}
