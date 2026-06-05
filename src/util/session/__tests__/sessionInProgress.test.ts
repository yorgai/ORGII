import { describe, expect, it } from "vitest";

import { isSessionInProgress } from "../sessionInProgress";

describe("isSessionInProgress", () => {
  describe("working status checks", () => {
    it.each([
      "running",
      "installing",
      "in_progress",
      "pending",
      "queued",
      "waiting_for_funds",
      "waiting_for_user",
    ])("returns true for %s status", (status) => {
      expect(isSessionInProgress(status)).toBe(true);
      expect(isSessionInProgress(status, {})).toBe(true);
    });

    it.each([
      "completed",
      "failed",
      "error",
      "cancelled",
      "abandoned",
      "timeout",
      "killed",
      "archived",
      "idle",
      "paused",
      undefined,
    ])("returns false for %s status", (status) => {
      expect(isSessionInProgress(status)).toBe(false);
    });
  });

  describe("session context", () => {
    it("does not require a pid for long-running active sessions", () => {
      const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      expect(
        isSessionInProgress("running", { pid: null, updated_at: staleTime })
      ).toBe(true);
    });

    it("does not suppress old active sessions based on timestamps", () => {
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      expect(
        isSessionInProgress("pending", { pid: null, created_at: oldTime })
      ).toBe(true);
      expect(
        isSessionInProgress("queued", { pid: null, updated_at: oldTime })
      ).toBe(true);
    });

    it("still returns false for terminal statuses with a pid", () => {
      expect(isSessionInProgress("completed", { pid: 12345 })).toBe(false);
      expect(isSessionInProgress("failed", { pid: 12345 })).toBe(false);
    });
  });
});
