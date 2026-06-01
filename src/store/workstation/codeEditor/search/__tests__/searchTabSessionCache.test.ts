/**
 * Tests for search tab session cache (LRU cache for search state).
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SEARCH_TAB_OPTIONS,
  clearSearchTabSessionStates,
  createDefaultSearchTabSessionState,
  deleteSearchTabSessionState,
  getSearchTabSessionState,
  setSearchTabSessionState,
} from "../searchTabSessionCache";

describe("searchTabSessionCache", () => {
  beforeEach(() => {
    // Clear cache before each test
    clearSearchTabSessionStates();
  });

  describe("createDefaultSearchTabSessionState", () => {
    it("creates state with empty query", () => {
      const state = createDefaultSearchTabSessionState();
      expect(state.query).toBe("");
    });

    it("creates state with default options", () => {
      const state = createDefaultSearchTabSessionState();
      expect(state.options.caseSensitive).toBe(false);
      expect(state.options.wholeWord).toBe(false);
      expect(state.options.useRegex).toBe(false);
      expect(state.options.fileExtensions).toEqual([]);
      expect(state.options.excludeDirs).toContain("node_modules");
      expect(state.options.excludeDirs).toContain(".git");
    });

    it("creates state with empty results", () => {
      const state = createDefaultSearchTabSessionState();
      expect(state.results).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.loadingMore).toBe(false);
      expect(state.error).toBeNull();
    });

    it("creates state with zero totals", () => {
      const state = createDefaultSearchTabSessionState();
      expect(state.actualTotalMatches).toBe(0);
      expect(state.actualTotalFiles).toBe(0);
      expect(state.hasMore).toBe(false);
    });
  });

  describe("DEFAULT_SEARCH_TAB_OPTIONS", () => {
    it("has expected default exclude directories", () => {
      expect(DEFAULT_SEARCH_TAB_OPTIONS.excludeDirs).toContain("node_modules");
      expect(DEFAULT_SEARCH_TAB_OPTIONS.excludeDirs).toContain(".git");
      expect(DEFAULT_SEARCH_TAB_OPTIONS.excludeDirs).toContain("dist");
      expect(DEFAULT_SEARCH_TAB_OPTIONS.excludeDirs).toContain("build");
    });

    it("has expected default flags", () => {
      expect(DEFAULT_SEARCH_TAB_OPTIONS.caseSensitive).toBe(false);
      expect(DEFAULT_SEARCH_TAB_OPTIONS.wholeWord).toBe(false);
      expect(DEFAULT_SEARCH_TAB_OPTIONS.useRegex).toBe(false);
      expect(DEFAULT_SEARCH_TAB_OPTIONS.onlyOpenFiles).toBe(false);
    });
  });

  describe("setSearchTabSessionState and getSearchTabSessionState", () => {
    it("stores and retrieves session state", () => {
      const state = createDefaultSearchTabSessionState();
      state.query = "test query";

      setSearchTabSessionState("session-1", state);
      const retrieved = getSearchTabSessionState("session-1");

      expect(retrieved).toBeDefined();
      expect(retrieved?.query).toBe("test query");
    });

    it("returns undefined for non-existent session", () => {
      const retrieved = getSearchTabSessionState("non-existent");
      expect(retrieved).toBeUndefined();
    });

    it("updates existing session state", () => {
      const state1 = createDefaultSearchTabSessionState();
      state1.query = "first query";
      setSearchTabSessionState("session-1", state1);

      const state2 = createDefaultSearchTabSessionState();
      state2.query = "updated query";
      setSearchTabSessionState("session-1", state2);

      const retrieved = getSearchTabSessionState("session-1");
      expect(retrieved?.query).toBe("updated query");
    });
  });

  describe("FIFO eviction", () => {
    it("evicts oldest session when cache exceeds MAX_SEARCH_TAB_SESSIONS (20)", () => {
      // Fill cache with 20 sessions
      for (let idx = 0; idx < 20; idx++) {
        const state = createDefaultSearchTabSessionState();
        state.query = `query-${idx}`;
        setSearchTabSessionState(`session-${idx}`, state);
      }

      // All 20 should exist
      expect(getSearchTabSessionState("session-0")).toBeDefined();
      expect(getSearchTabSessionState("session-19")).toBeDefined();

      // Add 21st session - should evict session-0
      const newState = createDefaultSearchTabSessionState();
      newState.query = "new-query";
      setSearchTabSessionState("session-20", newState);

      // session-0 should be evicted
      expect(getSearchTabSessionState("session-0")).toBeUndefined();
      // New session and others should exist
      expect(getSearchTabSessionState("session-20")).toBeDefined();
      expect(getSearchTabSessionState("session-1")).toBeDefined();
    });

    it("does not evict when updating existing session", () => {
      // Fill cache with 20 sessions
      for (let idx = 0; idx < 20; idx++) {
        const state = createDefaultSearchTabSessionState();
        state.query = `query-${idx}`;
        setSearchTabSessionState(`session-${idx}`, state);
      }

      // Update existing session (should not trigger eviction)
      const updatedState = createDefaultSearchTabSessionState();
      updatedState.query = "updated-query-5";
      setSearchTabSessionState("session-5", updatedState);

      // session-0 should still exist (no eviction occurred)
      expect(getSearchTabSessionState("session-0")).toBeDefined();
      expect(getSearchTabSessionState("session-5")?.query).toBe(
        "updated-query-5"
      );
    });
  });

  describe("deleteSearchTabSessionState", () => {
    it("removes specific session", () => {
      const state = createDefaultSearchTabSessionState();
      setSearchTabSessionState("session-to-delete", state);

      expect(getSearchTabSessionState("session-to-delete")).toBeDefined();

      deleteSearchTabSessionState("session-to-delete");

      expect(getSearchTabSessionState("session-to-delete")).toBeUndefined();
    });

    it("does not throw when deleting non-existent session", () => {
      expect(() => deleteSearchTabSessionState("non-existent")).not.toThrow();
    });
  });

  describe("clearSearchTabSessionStates", () => {
    it("removes all sessions", () => {
      for (let idx = 0; idx < 5; idx++) {
        const state = createDefaultSearchTabSessionState();
        setSearchTabSessionState(`session-${idx}`, state);
      }

      clearSearchTabSessionStates();

      for (let idx = 0; idx < 5; idx++) {
        expect(getSearchTabSessionState(`session-${idx}`)).toBeUndefined();
      }
    });
  });
});
