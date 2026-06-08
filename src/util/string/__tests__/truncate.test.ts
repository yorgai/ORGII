import { describe, expect, it } from "vitest";

import { truncate } from "../truncate";

describe("truncate", () => {
  it("returns the original string when it fits within max", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates and appends ellipsis when string exceeds max", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(truncate("abcdef", 4)).toBe("abc…");
  });

  it("the returned string is at most max characters long", () => {
    const result = truncate("a very long string that exceeds the limit", 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.endsWith("…")).toBe(true);
  });

  it("handles max equal to ellipsis length", () => {
    expect(truncate("hello", 1)).toBe("…");
  });

  it("uses custom ellipsis when provided", () => {
    expect(truncate("hello world", 8, { ellipsis: "..." })).toBe("hello...");
    expect(truncate("hello world", 8, { ellipsis: "..." }).length).toBe(8);
  });

  it("does not truncate when already at the limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("hello!", 5)).toBe("hell…");
  });

  it("collapseNewlines replaces newlines with spaces and trims", () => {
    const text = "  line one\nline two  ";
    expect(truncate(text, 100, { collapseNewlines: true })).toBe(
      "line one line two"
    );
  });

  it("collapseNewlines then truncates", () => {
    const text = "line one\nline two";
    expect(truncate(text, 12, { collapseNewlines: true })).toBe("line one li…");
  });

  it("returns string unchanged when collapseNewlines is false (default)", () => {
    const text = "line\none";
    expect(truncate(text, 100)).toBe("line\none");
  });
});
