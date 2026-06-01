import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetSessionCacheForTests,
  readPersisted,
  storageKeyFor,
  writePersisted,
} from "../useSessionAutoRefresh";

interface FakeStorage {
  store: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

function makeFakeStorage(): FakeStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
}

describe("useSessionAutoRefresh — cache helpers", () => {
  let fakeStorage: FakeStorage;

  beforeEach(() => {
    __resetSessionCacheForTests();
    fakeStorage = makeFakeStorage();
    vi.stubGlobal("localStorage", fakeStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("storageKeyFor", () => {
    it("namespaces under orgii:devRecord:cache and includes a version", () => {
      const key = storageKeyFor("cursor:2026-01-01:2026-01-31");
      expect(key).toBe("orgii:devRecord:cache:v1:cursor:2026-01-01:2026-01-31");
    });
  });

  describe("writePersisted / readPersisted", () => {
    it("round-trips data through localStorage", () => {
      writePersisted("k", [{ id: "a", value: 1 }]);

      const stored = fakeStorage.getItem(storageKeyFor("k"));
      expect(stored).not.toBeNull();

      __resetSessionCacheForTests();

      const loaded = readPersisted<{ id: string; value: number }[]>("k");
      expect(loaded?.data).toEqual([{ id: "a", value: 1 }]);
      expect(typeof loaded?.ts).toBe("number");
    });

    it("returns null when nothing is cached", () => {
      expect(readPersisted("missing")).toBeNull();
    });

    it("returns null when the persisted value is malformed", () => {
      fakeStorage.setItem(storageKeyFor("bad"), "not-json");
      expect(readPersisted("bad")).toBeNull();
    });

    it("returns null when the persisted shape is wrong", () => {
      fakeStorage.setItem(storageKeyFor("partial"), JSON.stringify({ ts: 1 }));
      expect(readPersisted("partial")).toBeNull();

      fakeStorage.setItem(
        storageKeyFor("noTs"),
        JSON.stringify({ data: [1, 2, 3] })
      );
      expect(readPersisted("noTs")).toBeNull();
    });

    it("prefers the in-memory cache over a stale localStorage entry", () => {
      writePersisted("k", { v: "memory" });

      fakeStorage.setItem(
        storageKeyFor("k"),
        JSON.stringify({ data: { v: "disk" }, ts: 0 })
      );

      const loaded = readPersisted<{ v: string }>("k");
      expect(loaded?.data).toEqual({ v: "memory" });
    });

    it("populates the in-memory cache after a localStorage hit", () => {
      fakeStorage.setItem(
        storageKeyFor("k"),
        JSON.stringify({ data: { v: 42 }, ts: 1 })
      );

      const first = readPersisted<{ v: number }>("k");
      expect(first?.data).toEqual({ v: 42 });

      fakeStorage.clear();
      const second = readPersisted<{ v: number }>("k");
      expect(second?.data).toEqual({ v: 42 });
    });

    it("survives a localStorage write failure (quota etc.)", () => {
      const throwingStorage: FakeStorage = {
        ...makeFakeStorage(),
        setItem: () => {
          throw new Error("QuotaExceeded");
        },
      };
      vi.stubGlobal("localStorage", throwingStorage);

      expect(() => writePersisted("k", { ok: true })).not.toThrow();
      const loaded = readPersisted<{ ok: boolean }>("k");
      expect(loaded?.data).toEqual({ ok: true });
    });
  });

  describe("entries are scoped per cacheKey", () => {
    it("different cacheKeys do not collide", () => {
      writePersisted("cursor:r1", [1]);
      writePersisted("cursor:r2", [2, 2]);

      __resetSessionCacheForTests();

      expect(readPersisted<number[]>("cursor:r1")?.data).toEqual([1]);
      expect(readPersisted<number[]>("cursor:r2")?.data).toEqual([2, 2]);
    });
  });
});
