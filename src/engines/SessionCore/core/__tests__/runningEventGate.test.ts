import { describe, expect, it } from "vitest";

import {
  latestAssistantActivityAfterLastUserAt,
  sessionHasComposerStopBlockingWork,
  sessionHasLiveRuntimeResource,
  sessionHasTurnBlockingRuntimeEvent,
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

function messageEvent(
  id: string,
  source: "assistant" | "user",
  createdAt: string,
  displayVariant: SessionEvent["displayVariant"] = "message"
): SessionEvent {
  return {
    id,
    sessionId: "session-1",
    source,
    createdAt,
    actionType: source === "user" ? "raw" : "assistant",
    functionName: source === "user" ? "user_message" : "assistant",
    displayStatus: "completed",
    displayVariant,
    args: {},
    result: {},
  } as unknown as SessionEvent;
}

describe("runningEventGate", () => {
  it("classifies background shell as live resource only", () => {
    const events = [shellEvent("background")];

    expect(sessionHasLiveRuntimeResource(events, "session-1")).toBe(true);
    expect(sessionHasTurnBlockingRuntimeEvent(events, "session-1")).toBe(false);
    expect(sessionHasComposerStopBlockingWork(events, "session-1")).toBe(false);
  });

  it("classifies foreground shell as live, turn-blocking, and composer-stop-blocking", () => {
    const events = [shellEvent("running")];

    expect(sessionHasLiveRuntimeResource(events, "session-1")).toBe(true);
    expect(sessionHasTurnBlockingRuntimeEvent(events, "session-1")).toBe(true);
    expect(sessionHasComposerStopBlockingWork(events, "session-1")).toBe(true);
  });

  it.each(["exited", "killed"] as const)(
    "classifies %s shell as settled for every running role",
    (shellProcessStatus) => {
      const events = [shellEvent(shellProcessStatus)];

      expect(sessionHasLiveRuntimeResource(events, "session-1")).toBe(false);
      expect(sessionHasTurnBlockingRuntimeEvent(events, "session-1")).toBe(
        false
      );
      expect(sessionHasComposerStopBlockingWork(events, "session-1")).toBe(
        false
      );
    }
  );

  it("classifies hidden running status as live and turn-blocking but not composer-stop-blocking", () => {
    const events = [hiddenStatusEvent()];

    expect(sessionHasLiveRuntimeResource(events, "session-1")).toBe(true);
    expect(sessionHasTurnBlockingRuntimeEvent(events, "session-1")).toBe(true);
    expect(sessionHasComposerStopBlockingWork(events, "session-1")).toBe(false);
  });

  it("tracks running assistant activity after the latest user turn", () => {
    const activityAt = "2026-06-08T17:06:05.000Z";
    const events = [
      messageEvent("user-1", "user", "2026-06-08T17:06:00.000Z"),
      {
        ...messageEvent("assistant-1", "assistant", activityAt),
        displayStatus: "running",
      },
    ];

    expect(latestAssistantActivityAfterLastUserAt(events, "session-1")).toBe(
      Date.parse(activityAt)
    );
  });

  it("ignores completed assistant history as active turn activity", () => {
    const events = [
      messageEvent("user-1", "user", "2026-06-08T17:06:00.000Z"),
      messageEvent("assistant-1", "assistant", "2026-06-08T17:06:05.000Z"),
    ];

    expect(latestAssistantActivityAfterLastUserAt(events, "session-1")).toBe(
      undefined
    );
  });

  it("resets assistant activity tracking at the next user turn", () => {
    const events = [
      messageEvent("user-1", "user", "2026-06-08T17:06:00.000Z"),
      messageEvent("assistant-1", "assistant", "2026-06-08T17:06:05.000Z"),
      messageEvent("user-2", "user", "2026-06-08T17:06:10.000Z"),
    ];

    expect(latestAssistantActivityAfterLastUserAt(events, "session-1")).toBe(
      undefined
    );
  });
});
