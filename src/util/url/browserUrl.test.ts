import { describe, expect, it } from "vitest";

import { normalizeBrowserInput } from "./browserUrl";

describe("normalizeBrowserInput", () => {
  it("preserves valid trailing characters in explicit URLs", () => {
    expect(normalizeBrowserInput("https://example.com/search?q=foo*")).toBe(
      "https://example.com/search?q=foo*"
    );
  });

  it("searches instead of navigating malformed explicit URLs", () => {
    expect(normalizeBrowserInput("https://exa*mple.com")).toBe(
      "https://www.google.com/search?q=https%3A%2F%2Fexa*mple.com"
    );
  });
});
