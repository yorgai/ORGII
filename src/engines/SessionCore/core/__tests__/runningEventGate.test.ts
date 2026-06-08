import { describe, expect, it } from "vitest";

import {
  hasRunningSessionEvent,
  hasTurnBlockingRunningSessionEvent,
} from "../runningEventGate";
import type { SessionEvent } from "../types";

function shellEvent(
  shellProcessStatus: "running" | "background" | "exited" | "killed"
): SessionEvent {
  return {
    id: `event-${shellProcessStatus}`,
    sessionId: "session-1",
    source: "assistant",
    createdAt: new Date().toISOString(),
    actionType: "tool_call",
    functionName: "run_shell",
    displayStatus: "completed",
    displayVariant: "tool_call",
    args: {
      command: "sleep 45",
      shellPid: 12345,
      shellProcessStatus,
    },
  } as unknown as SessionEvent;
}

describe("runningEventGate", () => {
  it("treats background shell processes as live resources but not turn-blocking work", () => {
    const events = [shellEvent("background")];

    expect(hasRunningSessionEvent(events, "session-1")).toBe(true);
    expect(hasTurnBlockingRunningSessionEvent(events, "session-1")).toBe(false);
  });

  it("treats foreground shell processes as both live and turn-blocking", () => {
    const events = [shellEvent("running")];

    expect(hasRunningSessionEvent(events, "session-1")).toBe(true);
    expect(hasTurnBlockingRunningSessionEvent(events, "session-1")).toBe(true);
  });

  it("does not treat exited shell processes as live or turn-blocking", () => {
    const events = [shellEvent("exited")];

    expect(hasRunningSessionEvent(events, "session-1")).toBe(false);
    expect(hasTurnBlockingRunningSessionEvent(events, "session-1")).toBe(false);
  });
});
