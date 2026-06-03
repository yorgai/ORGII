import { describe, expect, it } from "vitest";

import { getRoundPreviewText } from "../turnPageFormatting";

describe("getRoundPreviewText", () => {
  it("returns empty string for undefined input", () => {
    expect(getRoundPreviewText(undefined)).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(getRoundPreviewText("fix the login bug")).toBe("fix the login bug");
  });

  it("strips skill pill syntax, keeping only the display name", () => {
    expect(getRoundPreviewText("shell [skill:/shell] some text")).toBe(
      "shell some text"
    );
  });

  it("strips file pill syntax", () => {
    expect(
      getRoundPreviewText("README.md [file:/path/to/README.md] please review")
    ).toBe("README.md please review");
  });

  it("strips multiple pills", () => {
    const input =
      "shell [skill:/shell] and index.ts [file:/src/index.ts] do stuff";
    expect(getRoundPreviewText(input)).toBe("shell and index.ts do stuff");
  });

  it("normalizes extra whitespace left after stripping pills", () => {
    expect(getRoundPreviewText("shell [skill:/shell]   hello")).toBe(
      "shell hello"
    );
  });

  it("strips context pills with embedded base64 content", () => {
    const encoded = btoa(encodeURIComponent("some terminal output"));
    const input = `Terminal [terminal:terminal://abc::${encoded}] check this`;
    expect(getRoundPreviewText(input)).toBe("Terminal check this");
  });

  it("truncates at 96 characters with ellipsis", () => {
    const long = "a".repeat(100);
    const result = getRoundPreviewText(long);
    expect(result.length).toBe(96);
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not truncate at exactly 96 characters", () => {
    const exact = "a".repeat(96);
    expect(getRoundPreviewText(exact)).toBe(exact);
  });

  it("trims leading and trailing whitespace", () => {
    expect(getRoundPreviewText("  hello world  ")).toBe("hello world");
  });

  it("leaves messages without pill syntax unchanged when under limit", () => {
    const msg = "refactor the auth module to use JWT";
    expect(getRoundPreviewText(msg)).toBe(msg);
  });
});
