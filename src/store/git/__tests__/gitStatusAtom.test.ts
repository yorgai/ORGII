import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  GIT_STATUS_CACHE_CONFIG,
  computeGitStatusRetryDelay,
  isRepoGitStatusStale,
  pruneGitStatusCacheAtom,
  repoGitStatusCacheAtom,
} from "../gitStatusAtom";
import type { CachedRepoGitStatus } from "../gitStatusAtom";

const NOW = 1_700_000_000_000;

function makeEntry(
  overrides: Partial<CachedRepoGitStatus> = {}
): CachedRepoGitStatus {
  return {
    status: { uncommittedFiles: 0, ahead: 0, behind: 0 },
    fetchedAt: NOW,
    lastAccessed: NOW,
    ...overrides,
  };
}

describe("isRepoGitStatusStale", () => {
  it("treats missing entries as stale", () => {
    expect(isRepoGitStatusStale(undefined, false, NOW)).toBe(true);
    expect(isRepoGitStatusStale(undefined, true, NOW)).toBe(true);
  });

  it("keeps fresh entries within TTL", () => {
    const entry = makeEntry({ fetchedAt: NOW - 1000 });
    expect(isRepoGitStatusStale(entry, true, NOW)).toBe(false);
    expect(isRepoGitStatusStale(entry, false, NOW)).toBe(false);
  });

  it("marks priority entries stale after ACTIVE_REPO_TTL", () => {
    const entry = makeEntry({
      fetchedAt: NOW - GIT_STATUS_CACHE_CONFIG.ACTIVE_REPO_TTL - 1,
    });
    expect(isRepoGitStatusStale(entry, true, NOW)).toBe(true);
    // Non-priority repos use the longer INACTIVE_REPO_TTL
    expect(isRepoGitStatusStale(entry, false, NOW)).toBe(false);
  });

  it("marks non-priority entries stale after INACTIVE_REPO_TTL", () => {
    const entry = makeEntry({
      fetchedAt: NOW - GIT_STATUS_CACHE_CONFIG.INACTIVE_REPO_TTL - 1,
    });
    expect(isRepoGitStatusStale(entry, false, NOW)).toBe(true);
  });

  it("blocks refetch of error entries until retryAt elapses", () => {
    const entry = makeEntry({
      status: { uncommittedFiles: 0, ahead: 0, behind: 0, error: true },
      errorCount: 1,
      retryAt: NOW + 5000,
    });
    expect(isRepoGitStatusStale(entry, false, NOW)).toBe(false);
    expect(isRepoGitStatusStale(entry, true, NOW)).toBe(false);
    expect(isRepoGitStatusStale(entry, false, NOW + 5000)).toBe(true);
  });
});

describe("computeGitStatusRetryDelay", () => {
  it("uses exponential backoff starting at the base delay", () => {
    const base = GIT_STATUS_CACHE_CONFIG.ERROR_RETRY_BASE_MS;
    expect(computeGitStatusRetryDelay(1)).toBe(base);
    expect(computeGitStatusRetryDelay(2)).toBe(base * 2);
    expect(computeGitStatusRetryDelay(3)).toBe(base * 4);
  });

  it("caps the delay at ERROR_RETRY_MAX_MS", () => {
    expect(computeGitStatusRetryDelay(20)).toBe(
      GIT_STATUS_CACHE_CONFIG.ERROR_RETRY_MAX_MS
    );
  });
});

describe("pruneGitStatusCacheAtom", () => {
  it("removes entries older than STALE_THRESHOLD", () => {
    const store = createStore();
    const cache = new Map<string, CachedRepoGitStatus>([
      ["fresh", makeEntry({ fetchedAt: Date.now() })],
      [
        "ancient",
        makeEntry({
          fetchedAt: Date.now() - GIT_STATUS_CACHE_CONFIG.STALE_THRESHOLD - 1,
        }),
      ],
    ]);
    store.set(repoGitStatusCacheAtom, cache);

    store.set(pruneGitStatusCacheAtom);

    const pruned = store.get(repoGitStatusCacheAtom);
    expect(pruned.has("fresh")).toBe(true);
    expect(pruned.has("ancient")).toBe(false);
  });

  it("trims to MAX_ENTRIES keeping most recently accessed", () => {
    const store = createStore();
    const now = Date.now();
    const cache = new Map<string, CachedRepoGitStatus>();
    const total = GIT_STATUS_CACHE_CONFIG.MAX_ENTRIES + 10;
    for (let idx = 0; idx < total; idx++) {
      cache.set(
        `repo-${idx}`,
        makeEntry({ fetchedAt: now, lastAccessed: now - idx * 1000 })
      );
    }
    store.set(repoGitStatusCacheAtom, cache);

    store.set(pruneGitStatusCacheAtom);

    const pruned = store.get(repoGitStatusCacheAtom);
    expect(pruned.size).toBe(GIT_STATUS_CACHE_CONFIG.MAX_ENTRIES);
    // Most recently accessed survives; least recently accessed is evicted
    expect(pruned.has("repo-0")).toBe(true);
    expect(pruned.has(`repo-${total - 1}`)).toBe(false);
  });

  it("leaves the cache untouched when nothing is prunable", () => {
    const store = createStore();
    const cache = new Map<string, CachedRepoGitStatus>([
      ["a", makeEntry({ fetchedAt: Date.now() })],
    ]);
    store.set(repoGitStatusCacheAtom, cache);

    store.set(pruneGitStatusCacheAtom);

    expect(store.get(repoGitStatusCacheAtom)).toBe(cache);
  });
});
