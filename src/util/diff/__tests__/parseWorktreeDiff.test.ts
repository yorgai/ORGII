import { vi } from "vitest";

import {
  classifyDiffLine,
  extractDiffFileName,
  parseHunkNewStart,
  parseWorktreeDiff,
} from "../index";

vi.mock("@src/api/tauri/diff", () => ({}));

// ─────────────────────────────────────────────────────────────────────────────
// classifyDiffLine
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyDiffLine", () => {
  it("classifies diff header lines as 'file'", () => {
    expect(classifyDiffLine("diff --git a/foo b/foo")).toBe("file");
  });

  it("classifies --- lines as 'file'", () => {
    expect(classifyDiffLine("--- a/src/foo.ts")).toBe("file");
  });

  it("classifies +++ lines as 'file'", () => {
    expect(classifyDiffLine("+++ b/src/foo.ts")).toBe("file");
  });

  it("classifies @@ lines as 'hunk'", () => {
    expect(classifyDiffLine("@@ -1,3 +1,4 @@")).toBe("hunk");
  });

  it("classifies + lines as 'add'", () => {
    expect(classifyDiffLine("+new line")).toBe("add");
  });

  it("classifies - lines as 'remove'", () => {
    expect(classifyDiffLine("-old line")).toBe("remove");
  });

  it("classifies space-prefixed lines as 'context'", () => {
    expect(classifyDiffLine(" unchanged")).toBe("context");
  });

  it("classifies empty lines as 'context'", () => {
    expect(classifyDiffLine("")).toBe("context");
  });

  it("classifies plain text as 'context'", () => {
    expect(classifyDiffLine("just some text")).toBe("context");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractDiffFileName
// ─────────────────────────────────────────────────────────────────────────────

describe("extractDiffFileName", () => {
  it("strips the 'b/' prefix from a standard unified diff +++ line", () => {
    expect(extractDiffFileName("+++ b/src/foo.ts")).toBe("src/foo.ts");
  });

  it("handles nested paths with b/ prefix", () => {
    expect(extractDiffFileName("+++ b/a/b/c/file.ts")).toBe("a/b/c/file.ts");
  });

  it("falls back when there is no b/ prefix", () => {
    expect(extractDiffFileName("+++ src/bar.ts")).toBe("src/bar.ts");
  });

  it("returns the raw content after +++ when no path is present", () => {
    expect(extractDiffFileName("+++ /dev/null")).toBe("/dev/null");
  });

  it("handles leading whitespace around the +++ marker", () => {
    expect(extractDiffFileName("  +++ b/foo.ts")).toBe("foo.ts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseHunkNewStart
// ─────────────────────────────────────────────────────────────────────────────

describe("parseHunkNewStart", () => {
  it("parses a standard hunk header", () => {
    expect(parseHunkNewStart("@@ -1,3 +1,4 @@")).toBe(1);
  });

  it("parses a hunk starting at a non-zero line", () => {
    expect(parseHunkNewStart("@@ -10,5 +12,7 @@")).toBe(12);
  });

  it("parses a hunk header without the count part", () => {
    expect(parseHunkNewStart("@@ -1 +1 @@")).toBe(1);
  });

  it("parses a hunk header with trailing function context", () => {
    expect(parseHunkNewStart("@@ -5,10 +7,12 @@ function foo()")).toBe(7);
  });

  it("returns undefined for a non-hunk line", () => {
    expect(parseHunkNewStart("+++ b/foo.ts")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(parseHunkNewStart("")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseWorktreeDiff — integration
// ─────────────────────────────────────────────────────────────────────────────

describe("parseWorktreeDiff", () => {
  it("returns empty lines and files for an empty string", () => {
    const { lines, files } = parseWorktreeDiff("");
    expect(files).toHaveLength(0);
    // empty string still produces one context line ("")
    expect(lines[0].type).toBe("context");
  });

  it("parses a minimal single-file diff", () => {
    const raw = [
      "diff --git a/foo.ts b/foo.ts",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,2 +1,2 @@",
      " unchanged",
      "-old",
      "+new",
    ].join("\n");

    const { files } = parseWorktreeDiff(raw);

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("foo.ts");
    expect(files[0].addCount).toBe(1);
    expect(files[0].removeCount).toBe(1);
  });

  it("assigns new-side line numbers starting from the hunk header value", () => {
    const raw = [
      "+++ b/foo.ts",
      "@@ -5,3 +10,3 @@",
      " context",
      "-removed",
      "+added",
    ].join("\n");

    const { lines } = parseWorktreeDiff(raw);

    const hunkLine = lines.find((l) => l.type === "hunk");
    const contextLine = lines.find((l) => l.type === "context");
    const removedLine = lines.find((l) => l.type === "remove");
    const addedLine = lines.find((l) => l.type === "add");

    expect(hunkLine?.newLine).toBe(10);
    expect(contextLine?.newLine).toBe(10);
    expect(removedLine?.newLine).toBe(11); // counter doesn't advance for remove
    expect(addedLine?.newLine).toBe(11);
  });

  it("advances the counter for context and add lines but not remove lines", () => {
    const raw = ["@@ -1,4 +1,4 @@", " a", "-b", " c", "+d"].join("\n");
    const { lines } = parseWorktreeDiff(raw);

    const [, lineA, lineB, lineC, lineD] = lines;
    expect(lineA.newLine).toBe(1); // context "a"  → 1, counter becomes 2
    expect(lineB.newLine).toBe(2); // remove "b"   → 2, counter stays 2
    expect(lineC.newLine).toBe(2); // context "c"  → 2, counter becomes 3
    expect(lineD.newLine).toBe(3); // add "d"      → 3, counter becomes 4
  });

  it("parses a two-file diff correctly", () => {
    const raw = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-old_a",
      "+new_a",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,1 @@",
      "-old_b",
      "+new_b",
    ].join("\n");

    const { files } = parseWorktreeDiff(raw);

    expect(files).toHaveLength(2);
    expect(files[0].name).toBe("a.ts");
    expect(files[1].name).toBe("b.ts");
    expect(files[0].addCount).toBe(1);
    expect(files[0].removeCount).toBe(1);
    expect(files[1].addCount).toBe(1);
    expect(files[1].removeCount).toBe(1);
  });

  it("stores the correct lineIndex for the start of each file section", () => {
    const raw = [
      "+++ b/first.ts", // line 0
      "@@ -1 +1 @@", // line 1
      "+x", // line 2
      "+++ b/second.ts", // line 3
      "@@ -1 +1 @@", // line 4
      "+y", // line 5
    ].join("\n");

    const { files } = parseWorktreeDiff(raw);

    expect(files[0].lineIndex).toBe(0);
    expect(files[1].lineIndex).toBe(3);
  });

  it("resets the new-line counter at each new file boundary", () => {
    const raw = [
      "+++ b/a.ts",
      "@@ -1,1 +5,1 @@",
      "+line_in_a",
      "+++ b/b.ts",
      "@@ -1,1 +1,1 @@",
      "+line_in_b",
    ].join("\n");

    const { lines } = parseWorktreeDiff(raw);

    const addA = lines.find((l) => l.content === "+line_in_a");
    const addB = lines.find((l) => l.content === "+line_in_b");

    expect(addA?.newLine).toBe(5);
    expect(addB?.newLine).toBe(1);
  });

  it("assigns a prospective fileIndex to the +++ header line", () => {
    const raw = ["+++ b/only.ts", "@@ -1 +1 @@", "+x"].join("\n");

    const { lines } = parseWorktreeDiff(raw);
    const fileLine = lines.find(
      (l) => l.type === "file" && l.fileIndex !== undefined
    );

    // files[0] is the only file; the +++ line's fileIndex should be 0
    expect(fileLine?.fileIndex).toBe(0);
  });
});
