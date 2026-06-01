/**
 * Tests for search result display utilities.
 */
import { describe, expect, it } from "vitest";

import { formatMatchLine, formatSearchMatch } from "../utils";

describe("search component utils", () => {
  describe("formatMatchLine", () => {
    it("returns content unchanged when within maxLength", () => {
      const result = formatMatchLine("before ", "match", " after", 50);

      expect(result.before).toBe("before ");
      expect(result.match).toBe("match");
      expect(result.after).toBe(" after");
      expect(result.truncated).toBe(false);
    });

    it("trims leading whitespace and adds ellipsis", () => {
      const result = formatMatchLine("    indented", "match", " after", 50);

      expect(result.before).toBe("...indented");
      expect(result.truncated).toBe(true);
    });

    it("truncates long before context (keeps end closest to match)", () => {
      const longBefore = "a".repeat(100);
      const result = formatMatchLine(longBefore, "X", "", 50);

      expect(result.before.startsWith("...")).toBe(true);
      expect(result.before.length).toBeLessThan(100);
    });

    it("truncates long after context (keeps start closest to match)", () => {
      const longAfter = "z".repeat(100);
      const result = formatMatchLine("", "X", longAfter, 50);

      expect(result.after.endsWith("...")).toBe(true);
      expect(result.after.length).toBeLessThan(100);
    });

    it("balances truncation 60/40 (before/after)", () => {
      const longBefore = "b".repeat(100);
      const longAfter = "a".repeat(100);
      const result = formatMatchLine(longBefore, "M", longAfter, 50);

      // Both should be truncated
      expect(result.before.startsWith("...")).toBe(true);
      expect(result.after.endsWith("...")).toBe(true);
      expect(result.truncated).toBe(true);
    });

    it("handles empty context gracefully", () => {
      const result = formatMatchLine("", "match", "", 50);

      expect(result.before).toBe("");
      expect(result.match).toBe("match");
      expect(result.after).toBe("");
      expect(result.truncated).toBe(false);
    });

    it("preserves match text even when very long", () => {
      const longMatch = "M".repeat(100);
      const result = formatMatchLine("before", longMatch, "after", 50);

      // Match is preserved, contexts are truncated heavily
      expect(result.match).toBe(longMatch);
    });
  });

  describe("formatSearchMatch", () => {
    it("uses explicit context when present", () => {
      const match = {
        line: 10,
        column: 5,
        end_line: 10,
        end_column: 15,
        text: "match text",
        context_before: "prefix ",
        context_after: " suffix",
      };

      const result = formatSearchMatch(match, 50);

      expect(result.before).toBe("prefix ");
      expect(result.match).toBe("match text");
      expect(result.after).toBe(" suffix");
    });

    it("derives context from column indices when no explicit context", () => {
      const match = {
        line: 10,
        column: 8, // 1-indexed, so start at index 7
        end_line: 10,
        end_column: 13, // end at index 12
        text: "prefix match suffix",
        context_before: "",
        context_after: "",
      };

      const result = formatSearchMatch(match, 50);

      // With columns 8-13 on "prefix match suffix":
      // before = text[0:7] = "prefix "
      // match = text[7:12] = "match"
      // after = text[12:] = " suffix"
      expect(result.before).toBe("prefix ");
      expect(result.match).toBe("match");
      expect(result.after).toBe(" suffix");
    });

    it("falls back to full text as match when columns invalid", () => {
      const match = {
        line: 10,
        column: 1,
        end_line: 10,
        end_column: 1, // Invalid: end <= start
        text: "full line text",
        context_before: "",
        context_after: "",
      };

      const result = formatSearchMatch(match, 50);

      expect(result.match).toBe("full line text");
      expect(result.before).toBe("");
      expect(result.after).toBe("");
    });

    it("handles match at start of line", () => {
      const match = {
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 6,
        text: "match at start",
        context_before: "",
        context_after: "",
      };

      const result = formatSearchMatch(match, 50);

      expect(result.before).toBe("");
      expect(result.match).toBe("match");
      expect(result.after).toBe(" at start");
    });

    it("handles match at end of line", () => {
      // "at end: match" is 13 chars
      // column 9 (1-indexed) = index 8 = start of "match"
      // end_column 14 (1-indexed) = index 13 = end of "match"
      const match = {
        line: 1,
        column: 9,
        end_line: 1,
        end_column: 14,
        text: "at end: match",
        context_before: "",
        context_after: "",
      };

      const result = formatSearchMatch(match, 50);

      expect(result.before).toBe("at end: ");
      expect(result.match).toBe("match");
      expect(result.after).toBe("");
    });

    it("respects maxLength parameter", () => {
      const match = {
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 100,
        text: "x".repeat(200),
        context_before: "a".repeat(100),
        context_after: "b".repeat(100),
      };

      const result = formatSearchMatch(match, 30);

      // Total length should be controlled
      expect(result.truncated).toBe(true);
    });

    it("handles only context_before present", () => {
      const match = {
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 10,
        text: "match",
        context_before: "before ",
        context_after: "",
      };

      const result = formatSearchMatch(match, 50);

      // Has explicit context, so uses formatMatchLine path
      expect(result.before).toBe("before ");
      expect(result.match).toBe("match");
    });

    it("handles only context_after present", () => {
      const match = {
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 10,
        text: "match",
        context_before: "",
        context_after: " after",
      };

      const result = formatSearchMatch(match, 50);

      expect(result.after).toBe(" after");
      expect(result.match).toBe("match");
    });
  });
});
