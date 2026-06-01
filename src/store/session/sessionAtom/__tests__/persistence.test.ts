/**
 * Persistence invariants for `sessionsAtom`.
 *
 * The sidebar's "no spinner on cold start" UX relies on
 * `loadPersistedSessions()` returning the previous list synchronously and
 * `persistSessions()` capping the saved size so the localStorage quota
 * cannot be blown by a power user with thousands of sessions. Both contracts
 * are easy to break in a careless refactor — these tests lock them in.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  __PERSISTENCE_INTERNALS,
  loadPersistedSessions,
  persistSessions,
} from "../persistence";
import type { Session } from "../types";

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function makeSession(id: string, updatedAt: string): Session {
  return {
    session_id: id,
    status: "completed",
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: makeStorage(),
    configurable: true,
  });
});

describe("loadPersistedSessions", () => {
  it("returns [] when no cache exists", () => {
    expect(loadPersistedSessions()).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    localStorage.setItem(__PERSISTENCE_INTERNALS.STORAGE_KEY, "not json");
    expect(loadPersistedSessions()).toEqual([]);
  });

  it("returns [] for an unknown schema version", () => {
    localStorage.setItem(
      __PERSISTENCE_INTERNALS.STORAGE_KEY,
      JSON.stringify({ version: 999, sessions: [makeSession("a", "z")] })
    );
    expect(loadPersistedSessions()).toEqual([]);
  });

  it("round-trips sessions through write + read", () => {
    const sessions = [
      makeSession("a", "2026-01-01T00:00:00Z"),
      makeSession("b", "2026-02-01T00:00:00Z"),
    ];
    persistSessions(sessions);
    const loaded = loadPersistedSessions();
    expect(loaded.map((session) => session.session_id).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("strips volatile composer state from saved sessions", () => {
    const session: Session = {
      ...makeSession("a", "2026-01-01T00:00:00Z"),
      draftText: "unsent draft",
      replyTargetEventId: "event-1",
    };

    persistSessions([session]);
    const loaded = loadPersistedSessions();

    expect(loaded[0]?.draftText).toBeUndefined();
    expect(loaded[0]?.replyTargetEventId).toBeUndefined();
  });

  it("strips volatile composer state from legacy cached sessions", () => {
    const session: Session = {
      ...makeSession("a", "2026-01-01T00:00:00Z"),
      draftText: "legacy cached draft",
      replyTargetEventId: "event-1",
    };
    localStorage.setItem(
      __PERSISTENCE_INTERNALS.STORAGE_KEY,
      JSON.stringify({ version: 1, ts: Date.now(), sessions: [session] })
    );

    const loaded = loadPersistedSessions();

    expect(loaded[0]?.draftText).toBeUndefined();
    expect(loaded[0]?.replyTargetEventId).toBeUndefined();
  });
});

describe("persistSessions", () => {
  it("caps the persisted set at MAX_PERSISTED_ROWS, keeping most recent", () => {
    const cap = __PERSISTENCE_INTERNALS.MAX_PERSISTED_ROWS;
    const sessions: Session[] = [];
    for (let index = 0; index < cap + 50; index += 1) {
      const monthIndex = (index % 12) + 1;
      const monthLabel = String(monthIndex).padStart(2, "0");
      const dayLabel = String((index % 28) + 1).padStart(2, "0");
      sessions.push(
        makeSession(
          `session-${index}`,
          `2026-${monthLabel}-${dayLabel}T00:00:00Z`
        )
      );
    }
    persistSessions(sessions);
    const loaded = loadPersistedSessions();
    expect(loaded.length).toBe(cap);
    // The most recent updated_at must survive the truncation.
    const persistedTimestamps = loaded.map((session) => session.updated_at);
    const maxPersisted = persistedTimestamps.reduce((acc, ts) =>
      acc > ts ? acc : ts
    );
    const inputMax = sessions
      .map((session) => session.updated_at)
      .reduce((acc, ts) => (acc > ts ? acc : ts));
    expect(maxPersisted).toBe(inputMax);
  });

  it("survives a quota-exceeded write without throwing", () => {
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = ((key: string, value: string) => {
      if (key === __PERSISTENCE_INTERNALS.STORAGE_KEY) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      original(key, value);
    }) as typeof localStorage.setItem;

    expect(() => persistSessions([makeSession("a", "z")])).not.toThrow();
  });
});
