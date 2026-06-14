import { describe, expect, it } from "vitest";

import { shouldShowPlanningIndicator } from "./usePlanningIndicator";

const baseInput = {
  runtimeStatus: "running",
  isSessionActive: true,
  isPendingCancel: false,
  hasAwaitingUserInteraction: false,
  anyRunning: false,
  coldStartVisible: false,
  idleAfterVersion: 10,
  version: 10,
  hasLiveSubagent: false,
};

describe("shouldShowPlanningIndicator", () => {
  it("shows while the runtime is active and idle at the current version", () => {
    expect(shouldShowPlanningIndicator(baseInput)).toBe(true);
  });

  it("hides after Stop when runtime status is idle even if event state is stale", () => {
    expect(
      shouldShowPlanningIndicator({
        ...baseInput,
        runtimeStatus: "idle",
        isSessionActive: false,
      })
    ).toBe(false);
  });

  it("hides while a Stop is pending", () => {
    expect(
      shouldShowPlanningIndicator({ ...baseInput, isPendingCancel: true })
    ).toBe(false);
  });

  it("stays visible after a settled assistant reply while the turn is still running", () => {
    expect(shouldShowPlanningIndicator(baseInput)).toBe(true);
  });

  it("shows when non-visible running events exist but no visible running row is painted", () => {
    expect(
      shouldShowPlanningIndicator({
        ...baseInput,
        anyRunning: false,
      })
    ).toBe(true);
  });

  it("hides while a visible running row is painted", () => {
    expect(
      shouldShowPlanningIndicator({
        ...baseInput,
        anyRunning: true,
      })
    ).toBe(false);
  });

  it("shows during the parent gap when a background subagent is still running", () => {
    // Parent turn mechanically ended (runtimeStatus idle) but a
    // background subagent keeps the session alive — footer must stay up.
    expect(
      shouldShowPlanningIndicator({
        ...baseInput,
        runtimeStatus: "idle",
        hasLiveSubagent: true,
      })
    ).toBe(true);
  });

  it("does not show on a live subagent if a visible running row is already painted", () => {
    expect(
      shouldShowPlanningIndicator({
        ...baseInput,
        runtimeStatus: "idle",
        hasLiveSubagent: true,
        anyRunning: true,
      })
    ).toBe(false);
  });
});
