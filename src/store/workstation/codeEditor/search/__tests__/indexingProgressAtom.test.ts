/**
 * Tests for indexing progress atoms.
 */
import { createStore } from "jotai/vanilla";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelIndexingAtom,
  completeIndexingAtom,
  indexingPercentAtom,
  indexingProgressAtom,
  indexingStatusMessageAtom,
  isIndexingAtom,
  resetIndexingAtom,
  setIndexingErrorAtom,
  startIndexingProgressAtom,
  updateIndexingProgressAtom,
} from "../indexingProgressAtom";

describe("indexingProgressAtom", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("starts with idle status", () => {
      const progress = store.get(indexingProgressAtom);
      expect(progress.status).toBe("idle");
    });

    it("starts with zero progress", () => {
      expect(store.get(indexingPercentAtom)).toBe(0);
    });

    it("isIndexingAtom returns false when idle", () => {
      expect(store.get(isIndexingAtom)).toBe(false);
    });

    it("indexingStatusMessageAtom returns null when idle", () => {
      expect(store.get(indexingStatusMessageAtom)).toBeNull();
    });
  });

  describe("startIndexingProgressAtom", () => {
    it("sets status to scanning", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });

      const progress = store.get(indexingProgressAtom);
      expect(progress.status).toBe("scanning");
      expect(progress.repoId).toBe("repo-1");
      expect(progress.repoPath).toBe("/path/to/repo");
    });

    it("sets startedAt timestamp", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });

      const progress = store.get(indexingProgressAtom);
      expect(progress.startedAt).toBe(now);
    });

    it("accepts optional filesTotal", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
        filesTotal: 100,
      });

      const progress = store.get(indexingProgressAtom);
      expect(progress.filesTotal).toBe(100);
    });

    it("isIndexingAtom returns true when scanning", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });

      expect(store.get(isIndexingAtom)).toBe(true);
    });
  });

  describe("updateIndexingProgressAtom", () => {
    beforeEach(() => {
      const now = Date.now();
      vi.setSystemTime(now);
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
        filesTotal: 100,
      });
    });

    it("updates filesProcessed", () => {
      store.set(updateIndexingProgressAtom, { filesProcessed: 50 });

      const progress = store.get(indexingProgressAtom);
      expect(progress.filesProcessed).toBe(50);
    });

    it("calculates progress percentage from files", () => {
      store.set(updateIndexingProgressAtom, {
        filesProcessed: 25,
        filesTotal: 100,
      });

      expect(store.get(indexingPercentAtom)).toBe(25);
    });

    it("uses explicit progress when provided", () => {
      store.set(updateIndexingProgressAtom, {
        filesProcessed: 25,
        filesTotal: 100,
        progress: 50, // Override calculated value
      });

      expect(store.get(indexingPercentAtom)).toBe(50);
    });

    it("updates currentFile", () => {
      store.set(updateIndexingProgressAtom, {
        currentFile: "/path/to/current.ts",
      });

      const progress = store.get(indexingProgressAtom);
      expect(progress.currentFile).toBe("/path/to/current.ts");
    });

    it("updates status", () => {
      store.set(updateIndexingProgressAtom, { status: "indexing" });

      const progress = store.get(indexingProgressAtom);
      expect(progress.status).toBe("indexing");
    });

    it("calculates estimated time remaining", () => {
      const startTime = Date.now();
      vi.setSystemTime(startTime);

      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
        filesTotal: 100,
      });

      // Advance time and update progress
      vi.setSystemTime(startTime + 10000); // 10 seconds elapsed
      store.set(updateIndexingProgressAtom, {
        filesProcessed: 50,
        filesTotal: 100,
      });

      const progress = store.get(indexingProgressAtom);
      // 50 files in 10s = 5 files/s
      // 50 files remaining = 10s expected
      expect(progress.estimatedTimeRemaining).toBe(10000);
    });
  });

  describe("completeIndexingAtom", () => {
    it("sets status to ready", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(completeIndexingAtom);

      const progress = store.get(indexingProgressAtom);
      expect(progress.status).toBe("ready");
    });

    it("sets progress to 100%", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(completeIndexingAtom);

      expect(store.get(indexingPercentAtom)).toBe(100);
    });

    it("clears currentFile and estimatedTimeRemaining", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(updateIndexingProgressAtom, {
        currentFile: "/some/file.ts",
      });
      store.set(completeIndexingAtom);

      const progress = store.get(indexingProgressAtom);
      expect(progress.currentFile).toBeNull();
      expect(progress.estimatedTimeRemaining).toBeNull();
    });

    it("isIndexingAtom returns false when ready", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(completeIndexingAtom);

      expect(store.get(isIndexingAtom)).toBe(false);
    });
  });

  describe("setIndexingErrorAtom", () => {
    it("sets status to error with message", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(setIndexingErrorAtom, "Failed to read file");

      const progress = store.get(indexingProgressAtom);
      expect(progress.status).toBe("error");
      expect(progress.errorMessage).toBe("Failed to read file");
    });

    it("displays error in status message", () => {
      store.set(setIndexingErrorAtom, "Network error");

      expect(store.get(indexingStatusMessageAtom)).toBe("Network error");
    });
  });

  describe("cancelIndexingAtom", () => {
    it("sets status to cancelled", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(cancelIndexingAtom);

      const progress = store.get(indexingProgressAtom);
      expect(progress.status).toBe("cancelled");
    });
  });

  describe("resetIndexingAtom", () => {
    it("resets to default state", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(updateIndexingProgressAtom, {
        filesProcessed: 50,
        status: "indexing",
      });

      store.set(resetIndexingAtom);

      const progress = store.get(indexingProgressAtom);
      expect(progress.status).toBe("idle");
      expect(progress.progress).toBe(0);
      expect(progress.repoId).toBeNull();
      expect(progress.filesProcessed).toBe(0);
    });
  });

  describe("indexingStatusMessageAtom", () => {
    it('returns "Scanning files..." for scanning', () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });

      expect(store.get(indexingStatusMessageAtom)).toBe("Scanning files...");
    });

    it("returns file count for indexing", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
        filesTotal: 100,
      });
      store.set(updateIndexingProgressAtom, {
        status: "indexing",
        filesProcessed: 25,
      });

      expect(store.get(indexingStatusMessageAtom)).toBe(
        "Indexing 25/100 files"
      );
    });

    it("returns chunk count for embedding", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(updateIndexingProgressAtom, {
        status: "embedding",
        chunksEmbedded: 500,
      });

      expect(store.get(indexingStatusMessageAtom)).toBe("Embedding 500 chunks");
    });

    it('returns "Indexing complete" for ready', () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(completeIndexingAtom);

      expect(store.get(indexingStatusMessageAtom)).toBe("Indexing complete");
    });

    it('returns "Indexing cancelled" for cancelled', () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(cancelIndexingAtom);

      expect(store.get(indexingStatusMessageAtom)).toBe("Indexing cancelled");
    });
  });

  describe("isIndexingAtom", () => {
    it("returns true for scanning status", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });

      expect(store.get(isIndexingAtom)).toBe(true);
    });

    it("returns true for indexing status", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(updateIndexingProgressAtom, { status: "indexing" });

      expect(store.get(isIndexingAtom)).toBe(true);
    });

    it("returns true for embedding status", () => {
      store.set(startIndexingProgressAtom, {
        repoId: "repo-1",
        repoPath: "/path/to/repo",
      });
      store.set(updateIndexingProgressAtom, { status: "embedding" });

      expect(store.get(isIndexingAtom)).toBe(true);
    });

    it("returns false for other statuses", () => {
      store.set(completeIndexingAtom);
      expect(store.get(isIndexingAtom)).toBe(false);

      store.set(setIndexingErrorAtom, "error");
      expect(store.get(isIndexingAtom)).toBe(false);

      store.set(cancelIndexingAtom);
      expect(store.get(isIndexingAtom)).toBe(false);
    });
  });
});
