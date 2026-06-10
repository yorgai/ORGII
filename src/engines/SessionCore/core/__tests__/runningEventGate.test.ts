import { describe, expect, it } from "vitest";

import {
  isLiveRuntimeResourceEvent,
  sessionHasComposerStopBlockingWork,
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

function hiddenStatusEvent(): SessionEvent {
  return {
    id: "hidden-running",
    sessionId: "session-1",
    source: "assistant",
    createdAt: new Date().toISOString(),
    actionType: "raw",
    functionName: "hidden_status",
    displayStatus: "running",
    displayVariant: "session",
    result: { status: "running" },
  } as unknown as SessionEvent;
}

describe("runningEventGate", () => {
  it("classifies background shell as live resource only", () => {
    const events = [shellEvent("background")];

    expect(events.some(isLiveRuntimeResourceEvent)).toBe(true);
    expect(sessionHasComposerStopBlockingWork(events, "session-1")).toBe(false);
  });

  it("classifies foreground shell as live and composer-stop-blocking", () => {
    const events = [shellEvent("running")];

    expect(events.some(isLiveRuntimeResourceEvent)).toBe(true);
    expect(sessionHasComposerStopBlockingWork(events, "session-1")).toBe(true);
  });

  it.each(["exited", "killed"] as const)(
    "classifies %s shell as settled for every running role",
    (shellProcessStatus) => {
      const events = [shellEvent(shellProcessStatus)];

      expect(events.some(isLiveRuntimeResourceEvent)).toBe(false);
      expect(sessionHasComposerStopBlockingWork(events, "session-1")).toBe(
        false
      );
    }
  );

  it("classifies hidden running status as live but not composer-stop-blocking", () => {
    const events = [hiddenStatusEvent()];

    expect(events.some(isLiveRuntimeResourceEvent)).toBe(true);
    expect(sessionHasComposerStopBlockingWork(events, "session-1")).toBe(false);
  });
});
