/**
 * Tests for terminal creation throttle logic.
 *
 * Note: The module uses module-level state (lastTerminalCreationTime).
 * Since vitest runs tests in sequence within a file, we structure tests
 * to work with shared state by using a single comprehensive test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TERMINAL_CREATION_COOLDOWN_MS } from "../creationThrottle";

describe("creationThrottle", () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("has correct cooldown constant", () => {
    expect(TERMINAL_CREATION_COOLDOWN_MS).toBe(1000);
  });

  it("implements throttling correctly across the full lifecycle", async () => {
    // Advance time to clear any existing cooldown
    vi.advanceTimersByTime(TERMINAL_CREATION_COOLDOWN_MS + 100);

    const { tryBeginTerminalCreation } = await import("../creationThrottle");

    // 1. First call after cooldown should succeed
    const call1 = tryBeginTerminalCreation();
    expect(call1).toBe(true);

    // 2. Immediate second call should be blocked
    const call2 = tryBeginTerminalCreation();
    expect(call2).toBe(false);

    // 3. Still blocked at 500ms
    vi.advanceTimersByTime(500);
    const call3 = tryBeginTerminalCreation();
    expect(call3).toBe(false);

    // 4. Still blocked at 999ms (just under threshold)
    vi.advanceTimersByTime(499);
    const call4 = tryBeginTerminalCreation();
    expect(call4).toBe(false);

    // 5. Allowed at 1001ms (past threshold)
    vi.advanceTimersByTime(2);
    const call5 = tryBeginTerminalCreation();
    expect(call5).toBe(true);

    // 6. This call reset the timer, so immediate call should be blocked again
    const call6 = tryBeginTerminalCreation();
    expect(call6).toBe(false);

    // 7. Wait for cooldown and verify it works again
    vi.advanceTimersByTime(TERMINAL_CREATION_COOLDOWN_MS + 1);
    const call7 = tryBeginTerminalCreation();
    expect(call7).toBe(true);
  });
});
