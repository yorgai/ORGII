import { describe, expect, it } from "vitest";

import { isSessionInProgress } from "../sessionInProgress";

describe("isSessionInProgress", () => {
  describe("status-based checks", () => {
    it("returns true for waiting_for_user status", () => {
      expect(isSessionInProgress("waiting_for_user")).toBe(true);
      expect(isSessionInProgress("waiting_for_user", {})).toBe(true);
    });

    it("returns true for running status by default", () => {
      expect(isSessionInProgress("running")).toBe(true);
    });

    it("returns true for pending status by default", () => {
      expect(isSessionInProgress("pending")).toBe(true);
    });

    it("returns false for completed status", () => {
      expect(isSessionInProgress("completed")).toBe(false);
    });

    it("returns false for failed status", () => {
      expect(isSessionInProgress("failed")).toBe(false);
    });

    it("returns false for cancelled status", () => {
      expect(isSessionInProgress("cancelled")).toBe(false);
    });

    it("returns false for undefined status", () => {
      expect(isSessionInProgress(undefined)).toBe(false);
    });
  });

  describe("running status with session context", () => {
    it("returns true when session has a pid", () => {
      expect(isSessionInProgress("running", { pid: 12345 })).toBe(true);
    });

    it("returns true for recent running session without pid", () => {
      const recentTime = new Date().toISOString();
      expect(
        isSessionInProgress("running", { pid: null, updated_at: recentTime })
      ).toBe(true);
    });

    it("returns false for stale running session without pid", () => {
      // 6 minutes ago (> 5 minute threshold)
      const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      expect(
        isSessionInProgress("running", { pid: null, updated_at: staleTime })
      ).toBe(false);
    });

    it("uses created_at when updated_at is not available", () => {
      const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      expect(
        isSessionInProgress("running", { pid: null, created_at: staleTime })
      ).toBe(false);
    });
  });

  describe("pending status with session context", () => {
    it("returns true when session has a pid", () => {
      expect(isSessionInProgress("pending", { pid: 99999 })).toBe(true);
    });

    it("returns true for recent pending session without pid", () => {
      const recentTime = new Date().toISOString();
      expect(
        isSessionInProgress("pending", { pid: null, updated_at: recentTime })
      ).toBe(true);
    });

    it("returns false for stale pending session without pid", () => {
      // 3 minutes ago (> 2 minute threshold)
      const staleTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      expect(
        isSessionInProgress("pending", { pid: null, updated_at: staleTime })
      ).toBe(false);
    });
  });
});
