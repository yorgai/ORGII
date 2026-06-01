/**
 * Tests for search result cache atom.
 */
import { createStore } from "jotai/vanilla";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addToCacheAtom,
  cacheStatsAtom,
  clearSearchCacheAtom,
  generateCacheKey,
  getCachedResultAtom,
  hasCachedResultAtom,
  invalidateRepoCacheAtom,
  pruneExpiredCacheAtom,
  recordCacheHitAtom,
  recordCacheMissAtom,
  searchCacheAtom,
  searchCacheStatsAtom,
} from "../cacheAtom";

describe("cacheAtom", () => {
  describe("generateCacheKey", () => {
    it("generates key with mode, repo, and query", () => {
      const key = generateCacheKey("test query", "regex", "/path/to/repo");
      expect(key).toBe("regex:/path/to/repo:test query");
    });

    it("uses * for empty repo filter", () => {
      const key = generateCacheKey("search term", "regex", "");
      expect(key).toBe("regex:*:search term");
    });

    it("preserves special characters in query", () => {
      const key = generateCacheKey("foo::bar<T>", "regex", "repo");
      expect(key).toBe("regex:repo:foo::bar<T>");
    });
  });

  describe("cache atoms", () => {
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
      vi.useFakeTimers();
      store = createStore();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe("addToCacheAtom", () => {
      it("adds new entry to cache", () => {
        store.set(addToCacheAtom, {
          query: "test",
          mode: "regex",
          repoFilter: "/repo",
          results: [],
          totalCount: 0,
        });

        const cache = store.get(searchCacheAtom);
        expect(cache.size).toBe(1);
        expect(cache.get("regex:/repo:test")).toBeDefined();
      });

      it("sets timestamp on cache entry", () => {
        const now = Date.now();
        vi.setSystemTime(now);

        store.set(addToCacheAtom, {
          query: "test",
          mode: "regex",
          repoFilter: "/repo",
          results: [],
          totalCount: 0,
        });

        const cache = store.get(searchCacheAtom);
        const entry = cache.get("regex:/repo:test");
        expect(entry?.timestamp).toBe(now);
      });

      it("evicts oldest entry when at capacity", () => {
        const baseTime = Date.now();

        for (let index = 0; index < 50; index++) {
          vi.setSystemTime(baseTime + index * 1000);
          store.set(addToCacheAtom, {
            query: `query-${index}`,
            mode: "regex",
            repoFilter: "/repo",
            results: [],
            totalCount: 0,
          });
        }

        expect(store.get(searchCacheAtom).size).toBe(50);

        vi.setSystemTime(baseTime + 51 * 1000);
        store.set(addToCacheAtom, {
          query: "query-50",
          mode: "regex",
          repoFilter: "/repo",
          results: [],
          totalCount: 0,
        });

        const cache = store.get(searchCacheAtom);
        expect(cache.size).toBe(50);
        expect(cache.has("regex:/repo:query-0")).toBe(false);
        expect(cache.has("regex:/repo:query-50")).toBe(true);
      });
    });

    describe("hasCachedResultAtom and getCachedResultAtom", () => {
      it("returns false/null for non-existent entry", () => {
        const hasCached = store.get(hasCachedResultAtom);
        const getCached = store.get(getCachedResultAtom);

        expect(hasCached("test", "regex", "/repo")).toBe(false);
        expect(getCached("test", "regex", "/repo")).toBeNull();
      });

      it("returns true/entry for valid cached entry", () => {
        store.set(addToCacheAtom, {
          query: "test",
          mode: "regex",
          repoFilter: "/repo",
          results: [],
          totalCount: 5,
        });

        const hasCached = store.get(hasCachedResultAtom);
        const getCached = store.get(getCachedResultAtom);

        expect(hasCached("test", "regex", "/repo")).toBe(true);
        const entry = getCached("test", "regex", "/repo");
        expect(entry).not.toBeNull();
        expect(entry?.totalCount).toBe(5);
      });

      it("returns false/null for expired entry", () => {
        const now = Date.now();
        vi.setSystemTime(now);

        store.set(addToCacheAtom, {
          query: "test",
          mode: "regex",
          repoFilter: "/repo",
          results: [],
          totalCount: 5,
        });

        vi.setSystemTime(now + 5 * 60 * 1000 + 1);

        const hasCached = store.get(hasCachedResultAtom);
        const getCached = store.get(getCachedResultAtom);

        expect(hasCached("test", "regex", "/repo")).toBe(false);
        expect(getCached("test", "regex", "/repo")).toBeNull();
      });
    });

    describe("cache statistics", () => {
      it("records cache hits", () => {
        store.set(recordCacheHitAtom);
        store.set(recordCacheHitAtom);

        const stats = store.get(cacheStatsAtom);
        expect(stats.hits).toBe(2);
      });

      it("records cache misses", () => {
        store.set(recordCacheMissAtom);

        const stats = store.get(cacheStatsAtom);
        expect(stats.misses).toBe(1);
      });

      it("calculates hit rate in searchCacheStatsAtom", () => {
        store.set(recordCacheHitAtom);
        store.set(recordCacheHitAtom);
        store.set(recordCacheHitAtom);
        store.set(recordCacheMissAtom);

        const stats = store.get(searchCacheStatsAtom);
        expect(stats.hitRate).toBe(75);
      });

      it("returns 0% hit rate when no accesses", () => {
        const stats = store.get(searchCacheStatsAtom);
        expect(stats.hitRate).toBe(0);
      });
    });

    describe("invalidateRepoCacheAtom", () => {
      it("removes entries matching specific repo", () => {
        store.set(addToCacheAtom, {
          query: "test1",
          mode: "regex",
          repoFilter: "/repo-a",
          results: [],
          totalCount: 0,
        });
        store.set(addToCacheAtom, {
          query: "test2",
          mode: "regex",
          repoFilter: "/repo-b",
          results: [],
          totalCount: 0,
        });

        store.set(invalidateRepoCacheAtom, "/repo-a");

        const cache = store.get(searchCacheAtom);
        expect(cache.has("regex:/repo-a:test1")).toBe(false);
        expect(cache.has("regex:/repo-b:test2")).toBe(true);
      });

      it("removes entries with wildcard repo filter", () => {
        store.set(addToCacheAtom, {
          query: "test",
          mode: "regex",
          repoFilter: "",
          results: [],
          totalCount: 0,
        });

        store.set(invalidateRepoCacheAtom, "/any-repo");

        const cache = store.get(searchCacheAtom);
        expect(cache.has("regex:*:test")).toBe(false);
      });
    });

    describe("clearSearchCacheAtom", () => {
      it("clears all cached entries", () => {
        store.set(addToCacheAtom, {
          query: "test1",
          mode: "regex",
          repoFilter: "/repo",
          results: [],
          totalCount: 0,
        });

        store.set(clearSearchCacheAtom);

        expect(store.get(searchCacheAtom).size).toBe(0);
      });

      it("resets statistics", () => {
        store.set(recordCacheHitAtom);
        store.set(recordCacheMissAtom);

        store.set(clearSearchCacheAtom);

        const stats = store.get(cacheStatsAtom);
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
      });
    });

    describe("pruneExpiredCacheAtom", () => {
      it("removes expired entries", () => {
        const now = Date.now();
        vi.setSystemTime(now);

        store.set(addToCacheAtom, {
          query: "old-query",
          mode: "regex",
          repoFilter: "/repo",
          results: [],
          totalCount: 0,
        });

        vi.setSystemTime(now + 6 * 60 * 1000);

        store.set(addToCacheAtom, {
          query: "new-query",
          mode: "regex",
          repoFilter: "/repo",
          results: [],
          totalCount: 0,
        });

        const pruned = store.set(pruneExpiredCacheAtom);

        expect(pruned).toBe(1);
        const cache = store.get(searchCacheAtom);
        expect(cache.has("regex:/repo:old-query")).toBe(false);
        expect(cache.has("regex:/repo:new-query")).toBe(true);
      });
    });
  });
});
