/**
 * Tests for ComposerInput cut handler — pure logic only.
 *
 * DOM-level behaviour of `createCutHandler` is covered by TEST_CASES.md.
 * Here we test the extracted pure helper `partsToPlainText`.
 */
import { describe, expect, it } from "vitest";

import { type ComposerFragmentPart, partsToPlainText } from "../cutHandler";

function makePillPart(
  fileName: string,
  filePath = `/src/${fileName}`
): ComposerFragmentPart {
  return {
    kind: "pill",
    attrs: {
      filePath,
      fileName,
      isFolder: false,
      iconType: "file",
      lineStart: null,
      lineEnd: null,
    },
  };
}

describe("partsToPlainText", () => {
  it("returns empty string for empty parts list", () => {
    expect(partsToPlainText([])).toBe("");
  });

  it("joins consecutive text parts", () => {
    const parts: ComposerFragmentPart[] = [
      { kind: "text", text: "hello " },
      { kind: "text", text: "world" },
    ];
    expect(partsToPlainText(parts)).toBe("hello world");
  });

  it("converts newline parts to \\n", () => {
    const parts: ComposerFragmentPart[] = [
      { kind: "text", text: "line one" },
      { kind: "newline" },
      { kind: "text", text: "line two" },
    ];
    expect(partsToPlainText(parts)).toBe("line one\nline two");
  });

  it("uses fileName for pill parts", () => {
    expect(partsToPlainText([makePillPart("utils.ts")])).toBe("utils.ts");
  });

  it("uses fileName even when filePath differs (fileName takes precedence)", () => {
    const parts: ComposerFragmentPart[] = [
      {
        kind: "pill",
        attrs: {
          filePath: "/src/long/path/file.ts",
          fileName: "file.ts",
          isFolder: false,
          iconType: "file",
          lineStart: null,
          lineEnd: null,
        },
      },
    ];
    expect(partsToPlainText(parts)).toBe("file.ts");
  });

  it("strips zero-width spaces from text parts", () => {
    const parts: ComposerFragmentPart[] = [
      { kind: "text", text: "abc\u200Bdef" },
    ];
    expect(partsToPlainText(parts)).toBe("abcdef");
  });

  it("handles mixed text, pill, and newline sequence", () => {
    const parts: ComposerFragmentPart[] = [
      { kind: "text", text: "see " },
      makePillPart("index.tsx", "/src/index.tsx"),
      { kind: "newline" },
      { kind: "text", text: "for details" },
    ];
    expect(partsToPlainText(parts)).toBe("see index.tsx\nfor details");
  });

  it("handles multiple pills inline", () => {
    const parts: ComposerFragmentPart[] = [
      makePillPart("a.ts"),
      { kind: "text", text: " and " },
      makePillPart("b.ts"),
    ];
    expect(partsToPlainText(parts)).toBe("a.ts and b.ts");
  });

  it("handles only a newline part", () => {
    expect(partsToPlainText([{ kind: "newline" }])).toBe("\n");
  });

  it("handles only a pill part", () => {
    expect(partsToPlainText([makePillPart("README.md")])).toBe("README.md");
  });

  it("handles empty text part gracefully", () => {
    const parts: ComposerFragmentPart[] = [
      { kind: "text", text: "" },
      { kind: "text", text: "after" },
    ];
    expect(partsToPlainText(parts)).toBe("after");
  });
});
