import { describe, expect, it } from "vitest";

import {
  formatCompactStatNumber,
  formatDiffStatsLabel,
  formatStatNumber,
} from "../formatStatNumber";

describe("formatStatNumber", () => {
  it("returns 0 for zero", () => {
    expect(formatStatNumber(0)).toBe("0");
  });

  it("formats small numbers without separators", () => {
    expect(formatStatNumber(45)).toBe("45");
    expect(formatStatNumber(104)).toBe("104");
    expect(formatStatNumber(999)).toBe("999");
  });

  it("inserts thousands separators for large numbers", () => {
    expect(formatStatNumber(1000)).toBe("1,000");
    expect(formatStatNumber(12345)).toBe("12,345");
    expect(formatStatNumber(1000000)).toBe("1,000,000");
  });

  it("truncates fractional values to integers", () => {
    expect(formatStatNumber(104.9)).toBe("104");
    expect(formatStatNumber(-45.9)).toBe("-45");
  });

  it("preserves the sign for negative numbers", () => {
    expect(formatStatNumber(-45)).toBe("-45");
    expect(formatStatNumber(-12345)).toBe("-12,345");
  });

  it("collapses non-finite / NaN inputs to 0", () => {
    expect(formatStatNumber(Number.NaN)).toBe("0");
    expect(formatStatNumber(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatStatNumber(Number.NEGATIVE_INFINITY)).toBe("0");
  });
});

describe("formatCompactStatNumber", () => {
  it("keeps sub-thousand values as plain integers", () => {
    expect(formatCompactStatNumber(999)).toBe("999");
    expect(formatCompactStatNumber(623)).toBe("623");
  });

  it("abbreviates thousands with one decimal when needed", () => {
    expect(formatCompactStatNumber(1411)).toBe("1.4K");
    expect(formatCompactStatNumber(6241)).toBe("6.2K");
    expect(formatCompactStatNumber(21718)).toBe("22K");
  });

  it("drops trailing .0 for whole thousands", () => {
    expect(formatCompactStatNumber(1000)).toBe("1K");
    expect(formatCompactStatNumber(10000)).toBe("10K");
  });

  it("abbreviates millions compactly", () => {
    expect(formatCompactStatNumber(1453702)).toBe("1.5M");
  });

  it("collapses non-finite inputs to 0", () => {
    expect(formatCompactStatNumber(Number.NaN)).toBe("0");
  });
});

describe("formatDiffStatsLabel", () => {
  it("joins additions and deletions with full formatting", () => {
    expect(formatDiffStatsLabel(6241, 21718)).toBe("+6,241 -21,718");
    expect(formatDiffStatsLabel(0, 1453702)).toBe("-1,453,702");
  });
});
