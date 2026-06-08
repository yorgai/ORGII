import { describe, expect, it } from "vitest";

import { shouldShowPlanningIndicator } from "./usePlanningIndicator";

const baseInput = {
  runtimeStatus: "running",
  isSessionActive: true,
  isPendingCancel: false,
  hasAwaitingUserInteraction: false,
  lastIsSettledAssistantMessage: false,
  anyRunning: false,
  coldStartVisible: false,
  idleAfterVersion: 10,
  version: 10,
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

  it("hides after a settled assistant reply", () => {
    expect(
      shouldShowPlanningIndicator({
        ...baseInput,
        lastIsSettledAssistantMessage: true,
      })
    ).toBe(false);
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
});
