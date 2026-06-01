/**
 * `computeInhibitorAction` — pure decision function extracted from
 * `useSleepInhibitor`. These tests pin down the truth table that drives
 * every acquire/release Tauri call.
 *
 * Truth table (prevHeld, enabled, working) → action:
 *   F, F, F  → noop      (off + idle)
 *   F, F, T  → noop      (toggle off, session running but feature disabled)
 *   F, T, F  → noop      (toggle on, no work)
 *   F, T, T  → acquire   (toggle on, work started)
 *   T, F, F  → release   (toggle flipped off while held)
 *   T, F, T  → release   (toggle flipped off while held, session still running)
 *   T, T, F  → release   (work finished while feature still enabled)
 *   T, T, T  → noop      (already held, conditions unchanged)
 */
import { describe, expect, it } from "vitest";

import { computeInhibitorAction } from "../useSleepInhibitor";

describe("computeInhibitorAction", () => {
  const cases: Array<{
    prevHeld: boolean;
    enabled: boolean;
    working: boolean;
    expectedAction: "acquire" | "release" | "noop";
    expectedNextHeld: boolean;
  }> = [
    {
      prevHeld: false,
      enabled: false,
      working: false,
      expectedAction: "noop",
      expectedNextHeld: false,
    },
    {
      prevHeld: false,
      enabled: false,
      working: true,
      expectedAction: "noop",
      expectedNextHeld: false,
    },
    {
      prevHeld: false,
      enabled: true,
      working: false,
      expectedAction: "noop",
      expectedNextHeld: false,
    },
    {
      prevHeld: false,
      enabled: true,
      working: true,
      expectedAction: "acquire",
      expectedNextHeld: true,
    },
    {
      prevHeld: true,
      enabled: false,
      working: false,
      expectedAction: "release",
      expectedNextHeld: false,
    },
    {
      prevHeld: true,
      enabled: false,
      working: true,
      expectedAction: "release",
      expectedNextHeld: false,
    },
    {
      prevHeld: true,
      enabled: true,
      working: false,
      expectedAction: "release",
      expectedNextHeld: false,
    },
    {
      prevHeld: true,
      enabled: true,
      working: true,
      expectedAction: "noop",
      expectedNextHeld: true,
    },
  ];

  it.each(cases)(
    "prevHeld=$prevHeld enabled=$enabled working=$working → $expectedAction (next held=$expectedNextHeld)",
    ({ prevHeld, enabled, working, expectedAction, expectedNextHeld }) => {
      const result = computeInhibitorAction(prevHeld, enabled, working);
      expect(result.action).toBe(expectedAction);
      expect(result.nextHeld).toBe(expectedNextHeld);
    }
  );

  describe("idempotency under repeated calls", () => {
    it("returns noop forever once acquire has been applied and inputs are stable", () => {
      let held = false;
      // First tick: conditions become true → acquire.
      let result = computeInhibitorAction(held, true, true);
      expect(result.action).toBe("acquire");
      held = result.nextHeld;

      // Three idle re-renders with the same inputs should all be no-ops.
      for (let i = 0; i < 3; i += 1) {
        result = computeInhibitorAction(held, true, true);
        expect(result.action).toBe("noop");
        expect(result.nextHeld).toBe(true);
        held = result.nextHeld;
      }
    });

    it("returns noop forever once release has been applied and inputs are stable", () => {
      let held = true;
      let result = computeInhibitorAction(held, true, false);
      expect(result.action).toBe("release");
      held = result.nextHeld;

      for (let i = 0; i < 3; i += 1) {
        result = computeInhibitorAction(held, true, false);
        expect(result.action).toBe("noop");
        expect(result.nextHeld).toBe(false);
        held = result.nextHeld;
      }
    });
  });
});
