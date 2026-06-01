/**
 * Tests for Session Replay edit utilities.
 */
import { describe, expect, it } from "vitest";

import type { FileOperationEntry } from "../../types";
import { getEditStartLine } from "../editUtils";

// Helper to create a minimal FileOperationEntry for testing
// We use type assertion since getEditStartLine internally casts event to unknown
function createOp(eventData: Record<string, unknown>): FileOperationEntry {
  return {
    filePath: "/file.ts",
    fileName: "file.ts",
    directory: "/",
    type: "write",
    event: eventData,
    eventId: "test-id",
    isCurrent: true,
  } as unknown as FileOperationEntry;
}

describe("editUtils", () => {
  describe("getEditStartLine", () => {
    it("returns context_start_line when present", () => {
      const op = createOp({
        context_start_line: 42,
        start_line: 10,
      });

      expect(getEditStartLine(op)).toBe(42);
    });

    it("falls back to start_line when context_start_line not present", () => {
      const op = createOp({
        start_line: 25,
      });

      expect(getEditStartLine(op)).toBe(25);
    });

    it("falls back to line_number when start_line not present", () => {
      const op = createOp({
        line_number: 15,
      });

      expect(getEditStartLine(op)).toBe(15);
    });

    it("extracts from parameters.start_line", () => {
      const op = createOp({
        parameters: {
          start_line: 100,
        },
      });

      expect(getEditStartLine(op)).toBe(100);
    });

    it("extracts from parameters.line_number", () => {
      const op = createOp({
        parameters: {
          line_number: 50,
        },
      });

      expect(getEditStartLine(op)).toBe(50);
    });

    it("returns 0 when no line info available", () => {
      const op = createOp({});

      expect(getEditStartLine(op)).toBe(0);
    });

    it("returns 0 for null/undefined event", () => {
      const op = {
        filePath: "/file.ts",
        fileName: "file.ts",
        directory: "/",
        type: "write",
        event: null,
        eventId: "test-id",
        isCurrent: true,
      } as unknown as FileOperationEntry;

      expect(getEditStartLine(op)).toBe(0);
    });

    it("prioritizes context_start_line over other fields", () => {
      const op = createOp({
        context_start_line: 1,
        start_line: 2,
        line_number: 3,
        parameters: {
          start_line: 4,
          line_number: 5,
        },
      });

      expect(getEditStartLine(op)).toBe(1);
    });
  });
});
