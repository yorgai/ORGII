/**
 * Tests for terminal buffer persistence service.
 *
 * These tests focus on the pure logic functions (LRU eviction, staleness check).
 * Tauri filesystem operations are mocked since they require the Tauri runtime.
 */
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAllPersistedBuffers,
  clearPersistedBuffer,
  flushPendingWrites,
  loadPersistedBuffers,
  persistTerminalBuffer,
} from "../bufferPersistence";

// Mock Tauri APIs before importing the module
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/mock/app/data/"),
}));

vi.mock("@src/util/platform/tauri/init", () => ({
  isTauriReady: vi.fn().mockReturnValue(true),
}));

describe("bufferPersistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("loadPersistedBuffers", () => {
    it("returns empty map when file does not exist", async () => {
      vi.mocked(exists).mockResolvedValue(false);

      const result = await loadPersistedBuffers();

      expect(result.size).toBe(0);
    });

    it("parses valid stored buffers", async () => {
      const storedData = {
        version: 1,
        buffers: [
          {
            sessionId: "session-1",
            serialized: "terminal-content-1",
            timestamp: Date.now(),
          },
          {
            sessionId: "session-2",
            serialized: "terminal-content-2",
            timestamp: Date.now(),
          },
        ],
      };

      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(storedData));

      const result = await loadPersistedBuffers();

      expect(result.size).toBe(2);
      expect(result.get("session-1")?.serialized).toBe("terminal-content-1");
      expect(result.get("session-2")?.serialized).toBe("terminal-content-2");
    });

    it("filters out stale buffers (older than 7 days)", async () => {
      const sevenDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
      const storedData = {
        version: 1,
        buffers: [
          {
            sessionId: "fresh-session",
            serialized: "fresh-content",
            timestamp: Date.now(),
          },
          {
            sessionId: "stale-session",
            serialized: "stale-content",
            timestamp: sevenDaysAgo,
          },
        ],
      };

      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(storedData));

      const result = await loadPersistedBuffers();

      expect(result.size).toBe(1);
      expect(result.has("fresh-session")).toBe(true);
      expect(result.has("stale-session")).toBe(false);
    });

    it("returns empty map on invalid JSON", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue("invalid json {{{");

      const result = await loadPersistedBuffers();

      expect(result.size).toBe(0);
    });

    it("returns empty map on invalid version", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ version: 999, buffers: [] })
      );

      const result = await loadPersistedBuffers();

      expect(result.size).toBe(0);
    });
  });

  describe("persistTerminalBuffer + flushPendingWrites", () => {
    it("writes buffer to storage on flush", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ version: 1, buffers: [] })
      );
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      persistTerminalBuffer("test-session", "terminal-content");
      await flushPendingWrites();

      expect(writeTextFile).toHaveBeenCalledTimes(1);
      const writtenContent = vi.mocked(writeTextFile).mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.buffers).toHaveLength(1);
      expect(parsed.buffers[0].sessionId).toBe("test-session");
      expect(parsed.buffers[0].serialized).toBe("terminal-content");
    });

    it("truncates oversized buffers to MAX_BUFFER_SIZE_CHARS", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(
        JSON.stringify({ version: 1, buffers: [] })
      );
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      // Create a buffer larger than 500KB
      const largeContent = "x".repeat(600_000);
      persistTerminalBuffer("large-session", largeContent);
      await flushPendingWrites();

      const writtenContent = vi.mocked(writeTextFile).mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.buffers[0].serialized.length).toBe(500_000);
    });

    it("merges with existing buffers", async () => {
      const existingData = {
        version: 1,
        buffers: [
          {
            sessionId: "existing-session",
            serialized: "existing-content",
            timestamp: Date.now(),
          },
        ],
      };

      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingData));
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      persistTerminalBuffer("new-session", "new-content");
      await flushPendingWrites();

      const writtenContent = vi.mocked(writeTextFile).mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.buffers).toHaveLength(2);
    });

    it("updates existing buffer for same session", async () => {
      const existingData = {
        version: 1,
        buffers: [
          {
            sessionId: "session-1",
            serialized: "old-content",
            timestamp: Date.now() - 1000,
          },
        ],
      };

      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingData));
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      persistTerminalBuffer("session-1", "updated-content");
      await flushPendingWrites();

      const writtenContent = vi.mocked(writeTextFile).mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.buffers).toHaveLength(1);
      expect(parsed.buffers[0].serialized).toBe("updated-content");
    });

    it("caps total buffers at MAX_BUFFERS (10)", async () => {
      const existingData = {
        version: 1,
        buffers: Array.from({ length: 10 }, (_, idx) => ({
          sessionId: `session-${idx}`,
          serialized: `content-${idx}`,
          timestamp: Date.now() - (10 - idx) * 1000, // Oldest first
        })),
      };

      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingData));
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      persistTerminalBuffer("new-session", "new-content");
      await flushPendingWrites();

      const writtenContent = vi.mocked(writeTextFile).mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.buffers.length).toBe(10);
      // Newest should be first after sort
      expect(parsed.buffers[0].sessionId).toBe("new-session");
    });
  });

  describe("clearPersistedBuffer", () => {
    it("removes specific buffer from storage", async () => {
      const existingData = {
        version: 1,
        buffers: [
          {
            sessionId: "keep-session",
            serialized: "keep-content",
            timestamp: Date.now(),
          },
          {
            sessionId: "remove-session",
            serialized: "remove-content",
            timestamp: Date.now(),
          },
        ],
      };

      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingData));
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await clearPersistedBuffer("remove-session");

      const writtenContent = vi.mocked(writeTextFile).mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.buffers).toHaveLength(1);
      expect(parsed.buffers[0].sessionId).toBe("keep-session");
    });
  });

  describe("clearAllPersistedBuffers", () => {
    it("clears all buffers from storage", async () => {
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await clearAllPersistedBuffers();

      const writtenContent = vi.mocked(writeTextFile).mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.buffers).toHaveLength(0);
    });
  });
});
