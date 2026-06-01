/**
 * Shell converter: command keyword extraction.
 */
import { describe, expect, it } from "vitest";

import { parseCommandKeywords } from "../shellConverter";

describe("parseCommandKeywords", () => {
  it("returns empty string for empty input", () => {
    expect(parseCommandKeywords("")).toBe("");
  });

  it("extracts first token per shell segment and dedupes", () => {
    expect(parseCommandKeywords("cd foo && npm run build")).toBe("cd, npm");
  });

  it("splits on pipes and semicolons into separate keyword tokens", () => {
    expect(parseCommandKeywords("ls | wc; echo done")).toBe("ls, wc, echo");
  });
});
