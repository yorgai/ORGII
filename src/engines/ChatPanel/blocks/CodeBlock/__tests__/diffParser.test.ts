import { describe, expect, it } from "vitest";

import { parseUnifiedDiff, truncateDiff } from "../diffParser";

// ============================================
// parseUnifiedDiff
// ============================================

describe("parseUnifiedDiff", () => {
  it("parses a single-hunk diff and extracts start lines", () => {
    const diff = [
      "@@ -50,4 +50,4 @@",
      " context",
      "-old line",
      "+new line",
      " context2",
    ].join("\n");

    const result = parseUnifiedDiff(diff);
    expect(result.oldStartLine).toBe(50);
    expect(result.newStartLine).toBe(50);
    expect(result.oldValue).toBe("context\nold line\ncontext2");
    expect(result.newValue).toBe("context\nnew line\ncontext2");
  });

  it("defaults start line to undefined when there is no @@ header", () => {
    const diff = ["-old", "+new", " ctx"].join("\n");
    const result = parseUnifiedDiff(diff);
    expect(result.oldStartLine).toBeUndefined();
    expect(result.newStartLine).toBeUndefined();
  });

  it("handles new-file synthetic diff (@@ -0,0 +1,N @@)", () => {
    const diff = ["@@ -0,0 +1,3 @@", "+line1", "+line2", "+line3"].join("\n");
    const result = parseUnifiedDiff(diff);
    expect(result.oldStartLine).toBe(0);
    expect(result.newStartLine).toBe(1);
    expect(result.oldValue).toBe("");
    expect(result.newValue).toBe("line1\nline2\nline3");
  });

  it("inserts gap lines between hunks so line numbers are preserved", () => {
    // First hunk: lines 10-12; second hunk: lines 50-52 in old file.
    const diff = [
      "@@ -10,3 +10,3 @@",
      " ctx1",
      "-old1",
      "+new1",
      "@@ -50,3 +50,3 @@",
      " ctx2",
      "-old2",
      "+new2",
    ].join("\n");

    const result = parseUnifiedDiff(diff);
    expect(result.oldStartLine).toBe(10);
    expect(result.newStartLine).toBe(10);

    // Old stream: ctx1, old1, [gap of 47 empty lines], ctx2, old2
    // Gap = 50 - (10 + 3 [ctx1, old1 count as 2; no wait, the cursor advances
    // for each old line: ctx1 → 11, old1 → 12, so oldCursor=12 after hunk 1.
    // Next hunk starts at 50, so gap = 50 - 12 = 38 empty lines.
    const oldLines = result.oldValue.split("\n");
    const newLines = result.newValue.split("\n");

    // First two real lines
    expect(oldLines[0]).toBe("ctx1");
    expect(oldLines[1]).toBe("old1");

    // Some gap lines in between (38 empty lines for old stream)
    // Find where ctx2 appears
    const ctx2OldIdx = oldLines.indexOf("ctx2");
    expect(ctx2OldIdx).toBeGreaterThan(2); // after the gap
    expect(oldLines[ctx2OldIdx + 1]).toBe("old2");

    // New stream mirrors: ctx1, new1, [gap], ctx2, new2
    expect(newLines[0]).toBe("ctx1");
    expect(newLines[1]).toBe("new1");
    const ctx2NewIdx = newLines.indexOf("ctx2");
    expect(ctx2NewIdx).toBeGreaterThan(2);
    expect(newLines[ctx2NewIdx + 1]).toBe("new2");

    // The gap indices should be the same for old and new since both hunks
    // have matching start positions.
    expect(ctx2OldIdx).toBe(ctx2NewIdx);
  });

  it("handles asymmetric gaps (when old/new hunk starts differ)", () => {
    // Old hunk starts at 20, new hunk starts at 25.
    const diff = [
      "@@ -10,2 +10,2 @@",
      " ctx",
      "-old",
      "+new",
      "@@ -20,2 +25,2 @@",
      " ctx2",
      "-old2",
      "+new2",
    ].join("\n");

    const result = parseUnifiedDiff(diff);
    expect(result.oldStartLine).toBe(10);
    expect(result.newStartLine).toBe(10);

    const oldLines = result.oldValue.split("\n");
    const newLines = result.newValue.split("\n");

    // After first hunk: oldCursor = 12, newCursor = 12
    // Old gap: 20 - 12 = 8; new gap: 25 - 12 = 13.
    // gapCount = max(8, 13) = 13.
    // Old gets 8 empties, new gets 13 empties.
    const ctx2OldIdx = oldLines.indexOf("ctx2");
    const ctx2NewIdx = newLines.indexOf("ctx2");

    // Old has fewer gap lines so ctx2 appears earlier
    expect(ctx2OldIdx).toBeLessThan(ctx2NewIdx);
  });

  it("skips diff header lines (diff, index, ---, +++)", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "index abc..def 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,2 +1,2 @@",
      " context",
      "-removed",
      "+added",
    ].join("\n");

    const result = parseUnifiedDiff(diff);
    expect(result.oldStartLine).toBe(1);
    expect(result.newStartLine).toBe(1);
    expect(result.oldValue).toBe("context\nremoved");
    expect(result.newValue).toBe("context\nadded");
  });

  it("treats blank lines (no leading space or +/-) as context lines", () => {
    const diff = ["@@ -1,3 +1,3 @@", " line1", "", " line3"].join("\n");
    const result = parseUnifiedDiff(diff);
    expect(result.oldValue).toBe("line1\n\nline3");
    expect(result.newValue).toBe("line1\n\nline3");
  });
});

// ============================================
// truncateDiff
// ============================================

describe("truncateDiff", () => {
  it("truncates displayable lines while preserving header lines", () => {
    const diff = [
      "@@ -1,5 +1,5 @@",
      " line1",
      "-line2",
      "+line2b",
      " line3",
      " line4",
    ].join("\n");

    const truncated = truncateDiff(diff, 2);
    const lines = truncated.split("\n");
    // Header (@@ line) must be present
    expect(lines[0]).toBe("@@ -1,5 +1,5 @@");
    // Only 2 displayable lines should remain
    const displayable = lines.filter(
      (l) =>
        l !== "" &&
        !["@@", "diff ", "index ", "---", "+++"].some((p) => l.startsWith(p))
    );
    expect(displayable.length).toBe(2);
  });

  it("returns full diff when visibleLines exceeds total lines", () => {
    const diff = ["@@ -1,2 +1,2 @@", " ctx", "-old", "+new"].join("\n");
    expect(truncateDiff(diff, 100)).toBe(diff);
  });
});
