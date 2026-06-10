import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANCEL_REASON } from "@src/api/tauri/agent";

import {
  beginStopBoundary,
  cancelTurnForTimelineBoundary,
  isTimelineInterruptInFlight,
} from "./sessionTimelineBoundary";

const storeSetSpy = vi.hoisted(() => vi.fn());
const storeGetSpy = vi.hoisted(() => vi.fn());
const interruptSpy = vi.hoisted(() => vi.fn());
const markStoppedSpy = vi.hoisted(() => vi.fn());
const getEventsSpy = vi.hoisted(() => vi.fn());
const patchByIdsSpy = vi.hoisted(() => vi.fn());
const killAgentShellProcessSpy = vi.hoisted(() => vi.fn());

vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => ({ get: storeGetSpy, set: storeSetSpy }),
  isStoreInitialized: () => false,
}));

vi.mock("@src/engines/SessionCore/services/SessionService", () => ({
  SessionService: {
    interrupt: interruptSpy,
  },
}));

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    getEvents: getEventsSpy,
    patchByIds: patchByIdsSpy,
  },
}));

vi.mock("@src/services/terminal", () => ({
  killAgentShellProcess: killAgentShellProcessSpy,
}));

vi.mock(
  "@src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/streamHelpers",
  () => ({
    markSessionStreamingStopped: markStoppedSpy,
  })
);

describe("sessionTimelineBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeGetSpy.mockReturnValue(new Map());
    getEventsSpy.mockResolvedValue([]);
    patchByIdsSpy.mockResolvedValue(undefined);
    killAgentShellProcessSpy.mockResolvedValue("killed");
  });

  it("makes Stop boundary local and O(1)", () => {
    beginStopBoundary("session-1");

    expect(markStoppedSpy).toHaveBeenCalledWith("session-1");
    expect(storeSetSpy).toHaveBeenCalled();
    expect(interruptSpy).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent Stop interrupts for the same session", async () => {
    let resolveInterrupt!: () => void;
    interruptSpy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveInterrupt = resolve;
        })
    );

    const first = cancelTurnForTimelineBoundary("session-1", "stop");
    const second = cancelTurnForTimelineBoundary("session-1", "stop");

    expect(isTimelineInterruptInFlight("session-1", "stop")).toBe(true);
    expect(interruptSpy).toHaveBeenCalledTimes(1);
    expect(interruptSpy).toHaveBeenCalledWith({
      sessionId: "session-1",
      reason: CANCEL_REASON.USER_STOP,
      onError: undefined,
    });

    resolveInterrupt();
    await Promise.all([first, second]);

    expect(isTimelineInterruptInFlight("session-1", "stop")).toBe(false);
  });

  it("does not close running events for force-send boundaries", async () => {
    interruptSpy.mockResolvedValue(undefined);

    await cancelTurnForTimelineBoundary("session-1", "force-send");
    await Promise.resolve();

    expect(getEventsSpy).not.toHaveBeenCalled();
    expect(patchByIdsSpy).not.toHaveBeenCalled();
  });

  it("kills active shell processes for Stop boundaries", async () => {
    storeGetSpy.mockReturnValue(
      new Map([
        [
          "session-1",
          new Map([
            [
              123,
              {
                pid: 123,
                sessionId: "session-1",
                command: "sleep 45",
                status: "background",
                startedAt: Date.now(),
              },
            ],
          ]),
        ],
      ])
    );

    beginStopBoundary("session-1");
    await Promise.resolve();

    expect(killAgentShellProcessSpy).toHaveBeenCalledWith({
      pid: 123,
      sessionId: "session-1",
    });
  });

  it("closes local running events for Stop boundaries", async () => {
    getEventsSpy.mockResolvedValue([
      {
        id: "tool-call-1",
        sessionId: "session-1",
        displayStatus: "running",
        actionType: "tool_call",
        functionName: "run_shell",
        args: {},
      },
    ]);

    beginStopBoundary("session-1");
    await Promise.resolve();

    expect(patchByIdsSpy).toHaveBeenCalledWith(
      ["tool-call-1"],
      { displayStatus: "failed", activityStatus: "processed" },
      "session-1"
    );
  });

  it("skips backend interrupt for idle rewind boundaries", async () => {
    storeGetSpy.mockImplementation((atom: { debugLabel?: string }) => {
      if (atom.debugLabel === "isSessionActive") return false;
      if (atom.debugLabel === "sessionRuntimeStatus") return "idle";
      if (atom.debugLabel === "session/sortedEvents") return [];
      return new Map();
    });

    await cancelTurnForTimelineBoundary("session-1", "rewind");

    expect(interruptSpy).not.toHaveBeenCalled();
  });

  it("interrupts backend for active rewind boundaries", async () => {
    storeGetSpy.mockImplementation((atom: { debugLabel?: string }) => {
      if (atom.debugLabel === "isSessionActive") return true;
      if (atom.debugLabel === "sessionRuntimeStatus") return "running";
      if (atom.debugLabel === "session/sortedEvents") return [];
      return new Map();
    });
    interruptSpy.mockResolvedValue(undefined);

    await cancelTurnForTimelineBoundary("session-1", "rewind");

    expect(interruptSpy).toHaveBeenCalledWith({
      sessionId: "session-1",
      reason: CANCEL_REASON.USER_STOP,
      onError: undefined,
    });
  });

  it("keeps force-send and Stop boundaries independently deduplicated", async () => {
    interruptSpy.mockResolvedValue(undefined);

    await Promise.all([
      cancelTurnForTimelineBoundary("session-1", "stop"),
      cancelTurnForTimelineBoundary("session-1", "force-send"),
    ]);

    expect(interruptSpy).toHaveBeenCalledTimes(2);
    expect(interruptSpy).toHaveBeenNthCalledWith(1, {
      sessionId: "session-1",
      reason: CANCEL_REASON.USER_STOP,
      onError: undefined,
    });
    expect(interruptSpy).toHaveBeenNthCalledWith(2, {
      sessionId: "session-1",
      reason: CANCEL_REASON.FORCE_SEND,
      onError: undefined,
    });
  });
});
