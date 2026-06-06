import {
  hasQueueTurnSettledAfter,
  markQueueTurnSettled,
  markQueueTurnWorking,
  resetQueueTurnGateForTests,
  shouldQueueSubmitAsActiveTurn,
} from "../queueTurnGate";

describe("queueTurnGate", () => {
  beforeEach(() => {
    resetQueueTurnGateForTests();
  });

  it("treats a recently working unsettled turn as active even if current atoms look idle", () => {
    markQueueTurnWorking("session-1", 1_000);

    expect(
      shouldQueueSubmitAsActiveTurn({
        sessionId: "session-1",
        isActive: false,
        runtimeIsWorking: false,
        pendingCancel: false,
        submitGuardActive: false,
        now: 1_500,
      })
    ).toBe(true);
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
        submitGuardActive: false,
        now: 1_500,
      })
    ).toBe(false);
  });

  it("does not let another session's settle release this session's queued follow-up", () => {
    markQueueTurnWorking("session-1", 1_000);
    markQueueTurnSettled("session-2", 1_300);

    expect(hasQueueTurnSettledAfter("session-1", 1_100)).toBe(false);
    expect(
      shouldQueueSubmitAsActiveTurn({
        sessionId: "session-1",
        isActive: false,
        runtimeIsWorking: false,
        pendingCancel: false,
        submitGuardActive: false,
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
});
