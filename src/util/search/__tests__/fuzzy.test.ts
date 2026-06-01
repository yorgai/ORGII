import { fuzzyMatch, fuzzyScore } from "../fuzzy";

describe("fuzzyMatch", () => {
  it("returns true for empty query", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
  });

  it("returns true for exact match", () => {
    expect(fuzzyMatch("orgii", "orgii")).toBe(true);
  });

  it("returns true for subsequence match", () => {
    expect(fuzzyMatch("of", "orgii_frontend")).toBe(true);
  });

  it("returns false when query cannot be matched in order", () => {
    expect(fuzzyMatch("zyx", "abc")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(fuzzyMatch("ORGII", "orgii_frontend")).toBe(true);
    expect(fuzzyMatch("orgii", "ORGII_FRONTEND")).toBe(true);
  });

  it("handles single-character queries", () => {
    expect(fuzzyMatch("a", "abc")).toBe(true);
    expect(fuzzyMatch("z", "abc")).toBe(false);
  });
});

describe("fuzzyScore", () => {
  it("returns 0 for empty query", () => {
    expect(fuzzyScore("", "name")).toBe(0);
  });

  it("returns 1000 for exact match", () => {
    expect(fuzzyScore("hello", "hello")).toBe(1000);
  });

  it("returns 500 when name starts with query", () => {
    expect(fuzzyScore("pre", "prefix_value")).toBe(500);
  });

  it("returns 200 when name contains query as substring", () => {
    expect(fuzzyScore("mid", "before_mid_after")).toBe(200);
  });

  it("returns a positive score below 200 for fuzzy-only matches", () => {
    const score = fuzzyScore("xf", "xorg_frontend");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(200);
  });

  it("adds word-boundary bonus after underscore or hyphen", () => {
    const underscore = fuzzyScore("xy", "x_y");
    const hyphen = fuzzyScore("xy", "x-y");
    const noBoundary = fuzzyScore("xy", "xay");
    expect(underscore).toBeGreaterThan(noBoundary);
    expect(hyphen).toBeGreaterThan(noBoundary);
  });

  it("adds consecutive character bonus in fuzzy path", () => {
    const consecutive = fuzzyScore("abc", "abxc");
    const spread = fuzzyScore("abc", "axbyc");
    expect(consecutive).toBeGreaterThan(spread);
  });

  it("scores case-insensitively for exact and prefix paths", () => {
    expect(fuzzyScore("Hello", "hello")).toBe(1000);
    expect(fuzzyScore("pre", "PREFIX_rest")).toBe(500);
  });
});
