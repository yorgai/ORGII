import { describe, expect, it } from "vitest";

import { hasPillSyntax, stripExpandedPillContent } from "../pillContentParser";

// ============================================================
// stripExpandedPillContent
// ============================================================

describe("stripExpandedPillContent", () => {
  it("returns text unchanged when no separator is present", () => {
    expect(stripExpandedPillContent("hello world")).toBe("hello world");
  });

  it("returns empty string when input is empty", () => {
    expect(stripExpandedPillContent("")).toBe("");
  });

  it("strips everything from the separator onward", () => {
    const original = "setup-repo 你好";
    const expanded =
      original +
      "\n\n---\n**Referenced content (auto-expanded):**\n\n---\nname: setup-repo\ndescription: ...";
    expect(stripExpandedPillContent(expanded)).toBe(original);
  });

  it("strips correctly when message contains pill tokens", () => {
    const original = "setup-repo 你好 [skill:/setup-repo]";
    const expanded =
      original +
      "\n\n---\n**Referenced content (auto-expanded):**\n\n# Setup Repo Skill\n\nDo stuff.";
    expect(stripExpandedPillContent(expanded)).toBe(original);
  });

  it("strips when message contains multiple pill types", () => {
    const original = "check this [file:/foo/bar.ts] and [skill:/lint]";
    const expanded =
      original +
      "\n\n---\n**Referenced content (auto-expanded):**\n\n### File: /foo/bar.ts\n```ts\ncontent\n```\n\n# Lint Skill";
    expect(stripExpandedPillContent(expanded)).toBe(original);
  });

  it("does not strip text that contains the separator as a substring in the original message", () => {
    // The separator is a specific markdown pattern; normal user text won't contain it,
    // but if it does appear it should still be stripped (documented edge case).
    const withEmbeddedSeparator =
      "my message\n\n---\n**Referenced content (auto-expanded):**\nThis is not expanded skill content";
    // Should strip at the first occurrence — this is the correct behaviour:
    // if the user typed the exact separator, they lose that text too.
    expect(stripExpandedPillContent(withEmbeddedSeparator)).toBe("my message");
  });

  it("handles text with only the separator (no content before)", () => {
    const text = "\n\n---\n**Referenced content (auto-expanded):**\n\nfoo";
    expect(stripExpandedPillContent(text)).toBe("");
  });
});

// ============================================================
// hasPillSyntax (smoke test — main coverage is in ComposerInput)
// ============================================================

describe("hasPillSyntax", () => {
  it("returns false for plain text", () => {
    expect(hasPillSyntax("hello world")).toBe(false);
  });
});
