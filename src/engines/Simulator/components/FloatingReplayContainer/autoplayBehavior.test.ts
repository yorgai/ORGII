import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { TOOL_DISPLAY_BEHAVIOR } from "@src/engines/SessionCore/rendering/registry/types";

import {
  FINAL_RESULT_HOLD_MS,
  getFinalResultHoldRemainingMs,
  shouldHoldFinalToolResult,
} from "./autoplayBehavior";

function createEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: "event-1",
    timestamp: "2026-06-12T00:00:00.000Z",
    sequence: 1,
    actionType: "tool_call",
    functionName: "code_search",
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    ...overrides,
  } as SessionEvent;
}

describe("shouldHoldFinalToolResult", () => {
  it("holds final wait_for_result tool events", () => {
    expect(
      shouldHoldFinalToolResult(
        createEvent({ displayStatus: "completed" }),
        TOOL_DISPLAY_BEHAVIOR.WAIT_FOR_RESULT
      )
    ).toBe(true);
  });

  it("holds final stream tool events", () => {
    expect(
      shouldHoldFinalToolResult(
        createEvent({ functionName: "run_shell", displayStatus: "completed" }),
        TOOL_DISPLAY_BEHAVIOR.STREAM
      )
    ).toBe(true);
  });

  it("does not hold running tool events", () => {
    expect(
      shouldHoldFinalToolResult(
        createEvent({ displayStatus: "running" }),
        TOOL_DISPLAY_BEHAVIOR.WAIT_FOR_RESULT
      )
    ).toBe(false);
  });

  it("does not hold instant tool events", () => {
    expect(
      shouldHoldFinalToolResult(
        createEvent({ functionName: "read_file", displayStatus: "completed" }),
        TOOL_DISPLAY_BEHAVIOR.INSTANT
      )
    ).toBe(false);
  });
});

describe("getFinalResultHoldRemainingMs", () => {
  it("returns the full hold when the final event has not been seen", () => {
    expect(getFinalResultHoldRemainingMs(2000, undefined)).toBe(
      FINAL_RESULT_HOLD_MS
    );
  });

  it("returns remaining hold time", () => {
    expect(getFinalResultHoldRemainingMs(2400, 2000)).toBe(600);
  });

  it("does not return negative hold time", () => {
    expect(getFinalResultHoldRemainingMs(4000, 2000)).toBe(0);
  });
});
