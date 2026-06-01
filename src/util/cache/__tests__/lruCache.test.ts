import { vi } from "vitest";

import { LRUCache } from "../lruCache";

describe("LRUCache", () => {
  describe("without TTL", () => {
    it("sets and gets basic values", () => {
      const cache = new LRUCache<string, number>(10);
      cache.set("k", 7);
      expect(cache.get("k")).toBe(7);
    });

    it("evicts least recently used when at capacity", () => {
      const cache = new LRUCache<string, string>(2);
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe("2");
      expect(cache.get("c")).toBe("3");
    });

    it("get() moves an item to the most recent position", () => {
      const cache = new LRUCache<string, string>(2);
      cache.set("a", "1");
      cache.set("b", "2");
      cache.get("a");
      cache.set("c", "3");
      expect(cache.get("a")).toBe("1");
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe("3");
    });

    it("peek() does not update LRU order", () => {
      const cache = new LRUCache<string, string>(2);
      cache.set("a", "1");
      cache.set("b", "2");
      expect(cache.peek("a")?.value).toBe("1");
      cache.set("c", "3");
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe("2");
      expect(cache.get("c")).toBe("3");
    });

    it("getStats() returns correct utilization", () => {
      const cache = new LRUCache<string, number>(4);
      cache.set("x", 1);
      cache.set("y", 2);
      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(4);
      expect(stats.utilizationPercent).toBe(50);
    });

    it("clear() removes all entries", () => {
      const cache = new LRUCache<string, number>(5);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get("a")).toBeUndefined();
    });

    it("delete() removes a specific entry", () => {
      const cache = new LRUCache<string, number>(5);
      cache.set("a", 1);
      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.delete("a")).toBe(false);
    });
  });

  describe("with TTL", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns undefined from get() when entry is expired", () => {
      const ttl = 1000;
      const cache = new LRUCache<string, string>(10, ttl);
      cache.set("k", "v");
      vi.advanceTimersByTime(ttl + 1);
      expect(cache.get("k")).toBeUndefined();
    });

    it("has() returns false for expired entries", () => {
      const ttl = 500;
      const cache = new LRUCache<string, string>(10, ttl);
      cache.set("k", "v");
      vi.advanceTimersByTime(ttl + 1);
      expect(cache.has("k")).toBe(false);
    });

    it("isFresh() returns false for expired entries", () => {
      const ttl = 500;
      const cache = new LRUCache<string, string>(10, ttl);
      cache.set("k", "v");
      vi.advanceTimersByTime(ttl + 1);
      expect(cache.isFresh("k")).toBe(false);
    });

    it("pruneExpired() removes expired entries and returns count", () => {
      const ttl = 1000;
      const cache = new LRUCache<string, string>(10, ttl);
      cache.set("old", "1");
      vi.advanceTimersByTime(2000);
      cache.set("new", "2");
      const pruned = cache.pruneExpired();
      expect(pruned).toBe(1);
      expect(cache.size).toBe(1);
      expect(cache.get("new")).toBe("2");
    });

    it("getValidKeys() excludes expired keys", () => {
      const ttl = 1000;
      const cache = new LRUCache<string, string>(10, ttl);
      cache.set("stale", "1");
      vi.advanceTimersByTime(500);
      cache.set("fresh", "2");
      vi.advanceTimersByTime(600);
      const keys = cache.getValidKeys().sort();
      expect(keys).toEqual(["fresh"]);
    });
  });
});
