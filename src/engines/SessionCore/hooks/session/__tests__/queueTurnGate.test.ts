import {
  hasObservedUnsettledQueueTurn,
  hasQueueTurnSettledAfter,
  hasQueueTurnTerminatedAfter,
  hasQueueTurnWorkedThenSettledAfter,
  isQueueRuntimeStillWorking,
  markQueueTurnSettled,
  markQueueTurnWorking,
  resetQueueTurnGateForTests,
  shouldQueueSubmitAsActiveTurn,
} from "../queueTurnGate";

describe("queueTurnGate", () => {
  beforeEach(() => {
    resetQueueTurnGateForTests();
  });

  it("does not keep queueing from stale historical working markers once current atoms are idle", () => {
    markQueueTurnWorking("session-1", 1_000);

    expect(
      shouldQueueSubmitAsActiveTurn({
        sessionId: "session-1",
        isActive: false,
        runtimeIsWorking: false,
        pendingCancel: false,
        now: 60_000,
      })
    ).toBe(false);
  });

  it("does not keep queueing after the same turn has settled", () => {
    markQueueTurnWorking("session-1", 1_000);
    markQueueTurnSettled("session-1", 1_200);

    expect(
      shouldQueueSubmitAsActiveTurn({
        sessionId: "session-1",
        isActive: false,
        runtimeIsWorking: false,
        pendingCancel: false,
        now: 1_500,
      })
    ).toBe(false);
  });

  it("exposes unsettled observed working turns as a stronger active-turn hint", () => {
    expect(hasObservedUnsettledQueueTurn("session-1")).toBe(false);

    markQueueTurnWorking("session-1", 1_000);
    expect(hasObservedUnsettledQueueTurn("session-1")).toBe(true);

    markQueueTurnSettled("session-1", 1_200);
    expect(hasObservedUnsettledQueueTurn("session-1")).toBe(false);
  });

  it("does not let another session's settle release this session's queued follow-up", () => {
    markQueueTurnWorking("session-1", 1_000);
    markQueueTurnSettled("session-2", 1_300);

    expect(hasQueueTurnSettledAfter("session-1", 1_100)).toBe(false);
    expect(
      shouldQueueSubmitAsActiveTurn({
        sessionId: "session-1",
        isActive: false,
        runtimeIsWorking: true,
        pendingCancel: false,
        now: 1_500,
      })
    ).toBe(true);
  });

  it("allows dispatch only after a settle edge newer than the queued message", () => {
    markQueueTurnSettled("session-1", 1_000);
    expect(hasQueueTurnSettledAfter("session-1", 1_100)).toBe(false);

    markQueueTurnSettled("session-1", 1_250);
    expect(hasQueueTurnSettledAfter("session-1", 1_100)).toBe(true);
  });

  it("requires the matching turn_completed edge for turn-scoped queued follow-ups", () => {
    markQueueTurnSettled("session-1", 1_250, "turn-a", "completed");

    expect(hasQueueTurnSettledAfter("session-1", 1_100, "turn-a")).toBe(true);
    expect(hasQueueTurnSettledAfter("session-1", 1_100, "turn-b")).toBe(false);
  });

  it("does not release natural queued follow-ups from cancelled turns", () => {
    markQueueTurnSettled("session-1", 1_250, "turn-a", "cancelled");

    expect(hasQueueTurnSettledAfter("session-1", 1_100)).toBe(false);
    expect(hasQueueTurnSettledAfter("session-1", 1_100, "turn-a")).toBe(false);
  });

  it("allows force-send dispatch after any active turn terminal edge", () => {
    markQueueTurnSettled("session-1", 1_250, "turn-a", "cancelled");

    expect(hasQueueTurnTerminatedAfter("session-1", 1_100)).toBe(true);
    expect(hasQueueTurnTerminatedAfter("session-1", 1_100, "turn-a")).toBe(
      true
    );
    expect(hasQueueTurnTerminatedAfter("session-1", 1_100, "turn-b")).toBe(
      false
    );
  });

  it("does not treat pre-interrupt terminal edges as force-send release", () => {
    markQueueTurnSettled("session-1", 1_250, "turn-a", "cancelled");

    expect(hasQueueTurnTerminatedAfter("session-1", 1_500)).toBe(false);
  });

  it("binds pending rust turn queues to the first terminal edge after enqueue", () => {
    markQueueTurnSettled("session-1", 1_250, "turn-a", "cancelled");
    markQueueTurnSettled("session-1", 2_000, "turn-b", "completed");

    expect(
      hasQueueTurnSettledAfter(
        "session-1",
        1_100,
        "__pending_rust_active_turn__"
      )
    ).toBe(false);
    expect(
      hasQueueTurnSettledAfter(
        "session-1",
        1_500,
        "__pending_rust_active_turn__"
      )
    ).toBe(true);
  });

  it("uses runtime status, not EventStore snapshots, as queue working truth", () => {
    expect(isQueueRuntimeStillWorking("completed")).toBe(false);
    expect(isQueueRuntimeStillWorking("idle")).toBe(false);
    expect(isQueueRuntimeStillWorking("running")).toBe(true);
    expect(isQueueRuntimeStillWorking("waiting_for_user")).toBe(true);
  });

  it("does not treat a late settle from the previous turn as settling a new explicit turn", () => {
    markQueueTurnWorking("session-1", 1_000);
    markQueueTurnSettled("session-1", 1_600);

    expect(hasQueueTurnWorkedThenSettledAfter("session-1", 1_500)).toBe(false);

    markQueueTurnWorking("session-1", 1_700);
    expect(hasQueueTurnWorkedThenSettledAfter("session-1", 1_500)).toBe(false);

    markQueueTurnSettled("session-1", 1_900);
    expect(hasQueueTurnWorkedThenSettledAfter("session-1", 1_500)).toBe(true);
  });
});
