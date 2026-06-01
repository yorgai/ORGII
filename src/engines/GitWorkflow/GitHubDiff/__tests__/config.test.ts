import { getLanguageFromPath } from "@src/config/languageMap";

import { calculateGutterWidth, formatLineNumber } from "../config";

describe("getLanguageFromPath", () => {
  it("resolves extension via LANGUAGE_MAP and handles missing paths", () => {
    expect(getLanguageFromPath("foo.ts")).toBe("typescript");
    expect(getLanguageFromPath("bar.py")).toBe("python");
    expect(getLanguageFromPath("file.rs")).toBe("rust");
    expect(getLanguageFromPath(undefined)).toBeUndefined();
    expect(getLanguageFromPath("noext")).toBeUndefined();
  });
});

describe("calculateGutterWidth", () => {
  it("uses at least STYLE_CONFIG.gutterWidth (50) until digits require more", () => {
    expect(calculateGutterWidth(9)).toBe(50);
    expect(calculateGutterWidth(100)).toBe(50);
    expect(calculateGutterWidth(10000)).toBe(66);
  });
});

describe("formatLineNumber", () => {
  it("pads defined line numbers and returns empty for undefined", () => {
    expect(formatLineNumber(5, 4)).toBe("   5");
    expect(formatLineNumber(undefined, 4)).toBe("");
    expect(formatLineNumber(100, 3)).toBe("100");
  });
});
