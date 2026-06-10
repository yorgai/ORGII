import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  markTurnRunning,
  markTurnTerminal,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { createSessionEventHandlerCallbacks } from "@src/engines/SessionCore/sync/sessionSyncStateHelpers";
import type { SessionEventHandlerStateActions } from "@src/engines/SessionCore/sync/sessionSyncStateHelpers";
import { updateSessionStatus } from "@src/store/session";

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    pinSession: vi.fn(),
    unpinSession: vi.fn(),
  },
}));

vi.mock("@src/store/session", () => ({
  updateSessionStatus: vi.fn(),
}));

vi.mock("@src/engines/SessionCore/control/turnLifecycle", () => ({
  markTurnRunning: vi.fn(),
  markTurnTerminal: vi.fn(),
  toTurnTerminalStatus: (status: string) =>
    status === "failed" || status === "error" || status === "timeout"
      ? "failed"
      : status === "cancelled" || status === "abandoned"
        ? "cancelled"
        : "completed",
}));

function createActions(): SessionEventHandlerStateActions & {
  streamingMap: Map<string, string>;
} {
  const actions = {
    streamingMap: new Map<string, string>(),
    setSessionContextTokens: vi.fn(),
    setSessionContextUsage: vi.fn(),
    setSessionContextBreakdown: vi.fn(),
    setSessionRuntimeStatus: vi.fn(),
    setSessionRuntimeError: vi.fn(),
    setPendingCancel: vi.fn(),
    setSessionRolledBack: vi.fn(),
    setStreamingDeltaContent: vi.fn((update) => {
      actions.streamingMap =
        typeof update === "function" ? update(actions.streamingMap) : update;
    }),
  };
  return actions;
}

describe("session sync state callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears live streaming content before completed status can leave Stop UI stuck", () => {
    const actions = createActions();
    actions.streamingMap.set("session-1", "live answer");
    const callbacks = createSessionEventHandlerCallbacks(
      "session-1",
      actions,
      vi.fn()
    );

    callbacks.onStreamingDelta?.({
      isStreaming: true,
      isThinking: false,
      content: "live answer",
    });
    expect(actions.streamingMap.get("session-1")).toBe("live answer");

    callbacks.onStreamingDelta?.({
      isStreaming: false,
      isThinking: false,
      content: "",
    });
    callbacks.onStatusChange?.("completed");

    expect(actions.streamingMap.has("session-1")).toBe(false);
    expect(actions.setSessionRuntimeStatus).toHaveBeenCalledWith("completed");
    expect(actions.setPendingCancel).toHaveBeenCalledWith(false);
    expect(eventStoreProxy.unpinSession).toHaveBeenCalledWith("session-1");
  });

  it("marks terminal status changes as FSM turn terminals", () => {
    const actions = createActions();
    const callbacks = createSessionEventHandlerCallbacks(
      "session-1",
      actions,
      vi.fn()
    );

    callbacks.onStatusChange?.("completed", undefined, {
      turnId: "turn-1",
      turnStatus: "completed",
    });

    expect(markTurnTerminal).toHaveBeenCalledWith("session-1", "completed");
  });

  it("does NOT mark the FSM terminal for intermediate status signals", () => {
    const actions = createActions();
    const callbacks = createSessionEventHandlerCallbacks(
      "session-1",
      actions,
      vi.fn()
    );

    callbacks.onStatusChange?.("completed", undefined, {
      intermediate: true,
    });

    expect(markTurnTerminal).not.toHaveBeenCalled();
  });

  it("does NOT leak intermediate signals into any session-level state", () => {
    // Regression: a per-message streaming_complete mid-turn used to write
    // "completed" into the runtime-status mirror, flipping the composer's
    // Stop button back to Send while the agent was still executing tools
    // (2026-06-10). Intermediate signals must be a full no-op.
    const actions = createActions();
    const callbacks = createSessionEventHandlerCallbacks(
      "session-1",
      actions,
      vi.fn()
    );

    callbacks.onStatusChange?.("completed", undefined, {
      intermediate: true,
    });

    expect(actions.setSessionRuntimeStatus).not.toHaveBeenCalled();
    expect(actions.setPendingCancel).not.toHaveBeenCalled();
    expect(eventStoreProxy.unpinSession).not.toHaveBeenCalled();
    expect(updateSessionStatus).not.toHaveBeenCalled();
  });

  it("opens the FSM turn on running status", () => {
    const actions = createActions();
    const callbacks = createSessionEventHandlerCallbacks(
      "session-1",
      actions,
      vi.fn()
    );

    callbacks.onStatusChange?.("running");

    expect(markTurnRunning).toHaveBeenCalledWith("session-1");
  });
});
