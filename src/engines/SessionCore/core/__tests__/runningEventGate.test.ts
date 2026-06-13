import { describe, expect, it } from "vitest";

import {
  hasLiveRuntimeResourceInLatestTurn,
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

  it("ignores stale running tools after the runtime is terminal", () => {
    const events = [shellEvent("running")];

    expect(
      sessionHasComposerStopBlockingWork(events, "session-1", "completed")
    ).toBe(false);
    expect(
      sessionHasComposerStopBlockingWork(events, "session-1", "failed")
    ).toBe(false);
  });

  it("classifies hidden running status as live but not composer-stop-blocking", () => {
    const events = [hiddenStatusEvent()];

    expect(events.some(isLiveRuntimeResourceEvent)).toBe(true);
    expect(sessionHasComposerStopBlockingWork(events, "session-1")).toBe(false);
  });
});

function userEvent(id: string): SessionEvent {
  return {
    id,
    sessionId: "session-1",
    source: "user",
    createdAt: new Date().toISOString(),
    actionType: "raw",
    functionName: "user_message",
    displayStatus: "completed",
    displayVariant: "message",
  } as unknown as SessionEvent;
}

function settledToolEvent(id: string): SessionEvent {
  return {
    id,
    sessionId: "session-1",
    source: "assistant",
    createdAt: new Date().toISOString(),
    actionType: "tool_call",
    functionName: "code_search",
    displayStatus: "completed",
    displayVariant: "tool_call",
    args: {},
  } as unknown as SessionEvent;
}

describe("hasLiveRuntimeResourceInLatestTurn", () => {
  it("detects a running event in the latest turn", () => {
    const events = [
      userEvent("u1"),
      settledToolEvent("t1"),
      shellEvent("running"),
    ];
    expect(hasLiveRuntimeResourceInLatestTurn(events)).toBe(true);
  });

  it("returns false when the latest turn is fully settled", () => {
    const events = [userEvent("u1"), settledToolEvent("t1")];
    expect(hasLiveRuntimeResourceInLatestTurn(events)).toBe(false);
  });

  it("ignores zombie running events from earlier turns", () => {
    // The regression: a frozen shellProcessStatus="running" event in an
    // old turn must not suppress the footer for the current turn.
    const events = [
      userEvent("u1"),
      shellEvent("running"),
      userEvent("u2"),
      settledToolEvent("t2"),
    ];
    expect(hasLiveRuntimeResourceInLatestTurn(events)).toBe(false);
  });

  it("ignores old-turn background shells (pinned dev servers)", () => {
    const events = [
      userEvent("u1"),
      shellEvent("background"),
      userEvent("u2"),
      settledToolEvent("t2"),
    ];
    expect(hasLiveRuntimeResourceInLatestTurn(events)).toBe(false);
  });

  it("scans the whole array when no user message exists", () => {
    const events = [settledToolEvent("t1"), shellEvent("running")];
    expect(hasLiveRuntimeResourceInLatestTurn(events)).toBe(true);
  });
});
