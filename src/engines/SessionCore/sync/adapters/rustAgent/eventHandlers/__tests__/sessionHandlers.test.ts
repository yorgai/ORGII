import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleTurnSummary } from "../sessionHandlers";

const { appendSpy, upsertSpy } = vi.hoisted(() => ({
  appendSpy: vi.fn().mockResolvedValue(undefined),
  upsertSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    append: appendSpy,
    upsert: upsertSpy,
  },
}));

describe("Rust Agent session handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("anchors turn_summary events by turn id and backend timestamp", () => {
    handleTurnSummary(
      {
        type: "agent:turn_summary",
        sessionId: "session-1",
        turnId: "turn-1",
        createdAt: "2026-05-22T15:20:30.123Z",
        summary: "Completed the plan update.",
        toolCalls: 6,
        wallTimeSecs: 75,
      },
      "session-1"
    );

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).not.toHaveBeenCalled();
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "summary-turn-1",
        chunk_id: "summary-turn-1",
        sessionId: "session-1",
        createdAt: "2026-05-22T15:20:30.123Z",
        functionName: "turn_summary",
        displayText: "Completed the plan update.",
        args: {
          turnId: "turn-1",
          toolCalls: 6,
          wallTimeSecs: 75,
        },
      }),
      "session-1"
    );
  });

  it("drops unanchored turn_summary payloads instead of creating now-timestamped events", () => {
    handleTurnSummary(
      {
        type: "agent:turn_summary",
        sessionId: "session-1",
        summary: "Late unanchored summary.",
      },
      "session-1"
    );

    expect(upsertSpy).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
  });
});
