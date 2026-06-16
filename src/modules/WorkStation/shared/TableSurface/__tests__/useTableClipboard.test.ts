import { describe, expect, it } from "vitest";

import { parseClipboardText } from "../hooks/useTableClipboard";

describe("parseClipboardText", () => {
  it("parses tab-separated clipboard text", () => {
    expect(parseClipboardText("a\tb\nc\td\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("rejects overly long clipboard text", () => {
    expect(parseClipboardText("x".repeat(100_001))).toBeNull();
  });

  it("rejects too many clipboard cells", () => {
    const text = Array.from({ length: 10_001 }, () => "x").join("\n");
    expect(parseClipboardText(text)).toBeNull();
  });
});
