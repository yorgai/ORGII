/**
 * Unit tests for {@link BoundedMap}.
 *
 * Coverage:
 *   - Construction validation (positive integer maxSize).
 *   - LRU semantics for `get` / `set` / `touch` / `peek` / `has`.
 *   - Cap enforcement (set never grows past maxSize, oldest victim chosen).
 *   - `onEvict` callback contract (called once per cap-driven drop,
 *     never for `delete` / `clear` / same-key overwrites).
 *   - `onEvict` error containment (callback throws → map stays consistent).
 *   - Iteration order (oldest first).
 *   - `oldestKey()` and `evictOldest()` direct access paths.
 *   - Edge cases: undefined values stored explicitly, repeated overwrites,
 *     mixed access patterns.
 */
import { describe, expect, it, vi } from "vitest";

import { BoundedMap } from "../BoundedMap";

describe("BoundedMap — construction", () => {
  it("accepts a positive integer maxSize", () => {
    expect(() => new BoundedMap<string, number>({ maxSize: 1 })).not.toThrow();
    expect(
      () => new BoundedMap<string, number>({ maxSize: 1024 })
    ).not.toThrow();
  });

  it("rejects maxSize <= 0", () => {
    expect(() => new BoundedMap<string, number>({ maxSize: 0 })).toThrow(
      /positive integer/
    );
    expect(() => new BoundedMap<string, number>({ maxSize: -5 })).toThrow(
      /positive integer/
    );
  });

  it("rejects non-integer maxSize", () => {
    expect(() => new BoundedMap<string, number>({ maxSize: 1.5 })).toThrow(
      /positive integer/
    );
    expect(
      () => new BoundedMap<string, number>({ maxSize: Number.NaN })
    ).toThrow(/positive integer/);
  });

  it("rejects infinite maxSize (intentional bound is the whole point)", () => {
    expect(
      () =>
        new BoundedMap<string, number>({ maxSize: Number.POSITIVE_INFINITY })
    ).toThrow(/positive integer/);
  });

  it("exposes capacity as a read-only number", () => {
    const map = new BoundedMap<string, number>({ maxSize: 42 });
    expect(map.capacity).toBe(42);
  });
});

describe("BoundedMap — basic Map-shaped operations", () => {
  it("set then get returns the stored value", () => {
    const map = new BoundedMap<string, number>({ maxSize: 4 });
    map.set("a", 1);
    expect(map.get("a")).toBe(1);
  });

  it("has reflects presence without touching LRU order", () => {
    const map = new BoundedMap<string, number>({ maxSize: 2 });
    map.set("a", 1);
    map.set("b", 2);
    expect(map.has("a")).toBe(true);
    expect(map.has("c")).toBe(false);
    map.set("c", 3);
    // 'a' should have been evicted because has() didn't bump it.
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
    expect(map.has("c")).toBe(true);
  });

  it("peek returns the value without touching LRU order", () => {
    const map = new BoundedMap<string, number>({ maxSize: 2 });
    map.set("a", 1);
    map.set("b", 2);
    expect(map.peek("a")).toBe(1);
    map.set("c", 3);
    // 'a' was not touched by peek so it should be evicted.
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
    expect(map.has("c")).toBe(true);
  });

  it("delete removes the entry and returns true", () => {
    const map = new BoundedMap<string, number>({ maxSize: 4 });
    map.set("a", 1);
    expect(map.delete("a")).toBe(true);
    expect(map.has("a")).toBe(false);
    expect(map.delete("a")).toBe(false);
  });

  it("clear empties the map", () => {
    const map = new BoundedMap<string, number>({ maxSize: 4 });
    map.set("a", 1);
    map.set("b", 2);
    map.clear();
    expect(map.size).toBe(0);
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(false);
  });

  it("size reflects the current entry count", () => {
    const map = new BoundedMap<string, number>({ maxSize: 4 });
    expect(map.size).toBe(0);
    map.set("a", 1);
    expect(map.size).toBe(1);
    map.set("b", 2);
    expect(map.size).toBe(2);
    map.delete("a");
    expect(map.size).toBe(1);
  });
});

describe("BoundedMap — LRU semantics", () => {
  it("set bumps recency: most recent key survives capping", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    map.set("d", 4); // evicts 'a' (oldest)
    expect(map.has("a")).toBe(false);
    expect(map.toArray().map(([k]) => k)).toEqual(["b", "c", "d"]);
  });

  it("get bumps recency", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    map.get("a"); // bump 'a' to most recent
    map.set("d", 4); // evicts 'b' (now oldest)
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
    expect(map.toArray().map(([k]) => k)).toEqual(["c", "a", "d"]);
  });

  it("touch bumps recency without mutating the value", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    expect(map.touch("a")).toBe(true);
    expect(map.touch("zzz")).toBe(false);
    map.set("d", 4); // evicts 'b'
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
    expect(map.get("a")).toBe(1);
  });

  it("overwriting the same key counts as a touch", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    map.set("a", 99); // overwrite — bumps to most recent
    map.set("d", 4); // evicts 'b'
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
    expect(map.get("a")).toBe(99);
  });

  it("explicit undefined values are stored and distinguishable from absence", () => {
    const map = new BoundedMap<string, number | undefined>({ maxSize: 4 });
    map.set("a", undefined);
    expect(map.has("a")).toBe(true);
    expect(map.get("a")).toBeUndefined();
    expect(map.peek("missing")).toBeUndefined();
    expect(map.has("missing")).toBe(false);
  });
});

describe("BoundedMap — capacity enforcement", () => {
  it("never grows past maxSize", () => {
    const map = new BoundedMap<number, number>({ maxSize: 5 });
    for (let i = 0; i < 50; i++) {
      map.set(i, i * 10);
      expect(map.size).toBeLessThanOrEqual(5);
    }
    expect(map.size).toBe(5);
    // Last 5 keys retained.
    expect(map.toArray().map(([k]) => k)).toEqual([45, 46, 47, 48, 49]);
  });

  it("size cap of 1 keeps only the most recent key", () => {
    const map = new BoundedMap<string, number>({ maxSize: 1 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    expect(map.size).toBe(1);
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(false);
    expect(map.get("c")).toBe(3);
  });

  it("oldestKey returns the next eviction target", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    expect(map.oldestKey()).toBeUndefined();
    map.set("a", 1);
    map.set("b", 2);
    expect(map.oldestKey()).toBe("a");
    map.get("a"); // bump
    expect(map.oldestKey()).toBe("b");
  });

  it("evictOldest drops the oldest and reports success", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    expect(map.evictOldest()).toBe(false);
    map.set("a", 1);
    map.set("b", 2);
    expect(map.evictOldest()).toBe(true);
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
    expect(map.size).toBe(1);
  });
});

describe("BoundedMap — onEvict callback", () => {
  it("fires on cap-driven eviction with the evicted key/value", () => {
    const evicted: Array<[string, number]> = [];
    const map = new BoundedMap<string, number>({
      maxSize: 2,
      onEvict: (k, v) => {
        evicted.push([k, v]);
      },
    });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3); // evicts 'a'
    expect(evicted).toEqual([["a", 1]]);
    map.set("d", 4); // evicts 'b'
    expect(evicted).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("does NOT fire on explicit delete", () => {
    const onEvict = vi.fn();
    const map = new BoundedMap<string, number>({ maxSize: 4, onEvict });
    map.set("a", 1);
    map.delete("a");
    expect(onEvict).not.toHaveBeenCalled();
  });

  it("does NOT fire on clear", () => {
    const onEvict = vi.fn();
    const map = new BoundedMap<string, number>({ maxSize: 4, onEvict });
    map.set("a", 1);
    map.set("b", 2);
    map.clear();
    expect(onEvict).not.toHaveBeenCalled();
  });

  it("does NOT fire when overwriting an existing key", () => {
    const onEvict = vi.fn();
    const map = new BoundedMap<string, number>({ maxSize: 2, onEvict });
    map.set("a", 1);
    map.set("a", 2);
    map.set("a", 3);
    expect(onEvict).not.toHaveBeenCalled();
    expect(map.get("a")).toBe(3);
  });

  it("contains errors thrown from onEvict and keeps the map consistent", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = new BoundedMap<string, number>({
      maxSize: 1,
      onEvict: () => {
        throw new Error("boom");
      },
      name: "TestMap",
    });
    map.set("a", 1);
    // This eviction throws inside onEvict; the map should still drop 'a'
    // and accept 'b'.
    map.set("b", 2);
    expect(map.has("a")).toBe(false);
    expect(map.get("b")).toBe(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = (warnSpy.mock.calls[0]?.[0] ?? "") as string;
    expect(message).toContain("TestMap");
    warnSpy.mockRestore();
  });

  it("uses the default name when none is provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = new BoundedMap<string, number>({
      maxSize: 1,
      onEvict: () => {
        throw new Error("boom");
      },
    });
    map.set("a", 1);
    map.set("b", 2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = (warnSpy.mock.calls[0]?.[0] ?? "") as string;
    expect(message).toContain("BoundedMap");
    warnSpy.mockRestore();
  });
});

describe("BoundedMap — iteration", () => {
  it("keys iterate oldest-first", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    expect(Array.from(map.keys())).toEqual(["a", "b", "c"]);
    map.get("a"); // bump
    expect(Array.from(map.keys())).toEqual(["b", "c", "a"]);
  });

  it("values iterate oldest-first", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    map.set("c", 3);
    expect(Array.from(map.values())).toEqual([1, 2, 3]);
  });

  it("entries iterate oldest-first", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    expect(Array.from(map.entries())).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("[Symbol.iterator] yields the same as entries()", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    const fromForOf: Array<[string, number]> = [];
    for (const pair of map) {
      fromForOf.push(pair);
    }
    expect(fromForOf).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("toArray returns a snapshot independent of subsequent mutation", () => {
    const map = new BoundedMap<string, number>({ maxSize: 3 });
    map.set("a", 1);
    map.set("b", 2);
    const snap = map.toArray();
    map.delete("a");
    map.set("c", 3);
    expect(snap).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });
});

describe("BoundedMap — realistic write-buffer pattern", () => {
  it("flushes the evicted entry before letting the new one in", () => {
    const flushed: Array<{ key: string; payload: number }> = [];
    const map = new BoundedMap<string, number>({
      maxSize: 3,
      onEvict: (key, payload) => {
        flushed.push({ key, payload });
      },
    });
    // Simulate streaming sessions writing pending state.
    map.set("session-1", 100);
    map.set("session-2", 200);
    map.set("session-3", 300);
    // A fourth concurrent session arrives — session-1 must be flushed.
    map.set("session-4", 400);
    expect(flushed).toEqual([{ key: "session-1", payload: 100 }]);
    // session-1 is gone from the live map.
    expect(map.has("session-1")).toBe(false);
    // The remaining three are intact.
    expect(map.get("session-2")).toBe(200);
    expect(map.get("session-3")).toBe(300);
    expect(map.get("session-4")).toBe(400);
  });

  it("preserves an active session even under heavy churn from other keys", () => {
    const flushed = new Set<string>();
    const map = new BoundedMap<string, number>({
      maxSize: 4,
      onEvict: (key) => {
        flushed.add(key);
      },
    });
    map.set("hot", 1);
    // Inject many other sessions; touch "hot" each time so it stays.
    for (let i = 0; i < 100; i++) {
      map.touch("hot");
      map.set(`cold-${i}`, i);
    }
    expect(map.has("hot")).toBe(true);
    expect(flushed.has("hot")).toBe(false);
    expect(flushed.size).toBeGreaterThan(50);
  });
});
