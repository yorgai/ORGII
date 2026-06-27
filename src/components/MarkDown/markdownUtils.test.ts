import { describe, expect, it } from "vitest";

import { normalizeCopyableMarkdownDocumentFence } from "./markdownUtils";

describe("normalizeCopyableMarkdownDocumentFence", () => {
  it("uses a longer outer fence for markdown documents with nested fences", () => {
    const input = [
      "```md",
      "## Summary",
      "",
      "## Verification",
      "",
      "```bash",
      "pnpm run lint",
      "```",
      "```",
    ].join("\n");

    expect(normalizeCopyableMarkdownDocumentFence(input)).toBe(
      [
        "````md",
        "## Summary",
        "",
        "## Verification",
        "",
        "```bash",
        "pnpm run lint",
        "```",
        "````",
      ].join("\n")
    );
  });

  it("uses a fence longer than the longest nested fence", () => {
    const input = [
      "````markdown",
      "Example:",
      "````text",
      "nested",
      "````",
      "````",
    ].join("\n");

    expect(normalizeCopyableMarkdownDocumentFence(input)).toBe(
      ["`````markdown", "Example:", "````text", "nested", "````", "`````"].join(
        "\n"
      )
    );
  });

  it("leaves non-document markdown unchanged", () => {
    const input = [
      "Before",
      "",
      "```md",
      "## Summary",
      "```",
      "",
      "After",
    ].join("\n");

    expect(normalizeCopyableMarkdownDocumentFence(input)).toBe(input);
  });

  it("leaves markdown documents without nested fences unchanged", () => {
    const input = ["```md", "## Summary", "Plain text", "```"].join("\n");

    expect(normalizeCopyableMarkdownDocumentFence(input)).toBe(input);
  });
});
