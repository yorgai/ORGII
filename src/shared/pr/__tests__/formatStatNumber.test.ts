import { describe, expect, it } from "vitest";

import { formatStatNumber } from "../formatStatNumber";

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
