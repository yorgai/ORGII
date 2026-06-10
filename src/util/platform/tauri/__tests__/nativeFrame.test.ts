import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getUiScale, toNativeFrame } from "../nativeFrame";

function makeDOMRect(
  x: number,
  y: number,
  width: number,
  height: number
): DOMRect {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON() {
      return this;
    },
  };
}

function stubUiScale(value: string): void {
  const mockGetPropertyValue = vi.fn().mockReturnValue(value);
  vi.stubGlobal("document", {
    documentElement: {
      style: { getPropertyValue: vi.fn() },
    },
  });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: mockGetPropertyValue,
  }));
}

describe("getUiScale", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 1 when document is undefined", () => {
    vi.stubGlobal("document", undefined);
    expect(getUiScale()).toBe(1);
  });

  it("returns 1 when --ui-scale is empty", () => {
    stubUiScale("");
    expect(getUiScale()).toBe(1);
  });

  it("returns the numeric value of --ui-scale", () => {
    stubUiScale("0.8");
    expect(getUiScale()).toBeCloseTo(0.8);
  });

  it("returns 1 for NaN value", () => {
    stubUiScale("abc");
    expect(getUiScale()).toBe(1);
  });

  it("returns 1 for zero value", () => {
    stubUiScale("0");
    expect(getUiScale()).toBe(1);
  });

  it("returns 1 for negative value", () => {
    stubUiScale("-0.5");
    expect(getUiScale()).toBe(1);
  });

  it("returns 1.25 for 1.25 scale", () => {
    stubUiScale("1.25");
    expect(getUiScale()).toBeCloseTo(1.25);
  });

  it("handles whitespace-padded values", () => {
    stubUiScale("  1.5  ");
    expect(getUiScale()).toBeCloseTo(1.5);
  });
});

describe("toNativeFrame", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns rect values unchanged when scale is 1", () => {
    stubUiScale("1");
    const rect = makeDOMRect(100, 200, 800, 600);
    expect(toNativeFrame(rect)).toEqual({
      x: 100,
      y: 200,
      width: 800,
      height: 600,
    });
  });

  it("multiplies all values by scale factor", () => {
    stubUiScale("0.8");
    const rect = makeDOMRect(100, 200, 800, 600);
    expect(toNativeFrame(rect)).toEqual({
      x: 80,
      y: 160,
      width: 640,
      height: 480,
    });
  });

  it("applies inset before scaling", () => {
    stubUiScale("1");
    const rect = makeDOMRect(10, 20, 200, 100);
    expect(toNativeFrame(rect, 2)).toEqual({
      x: 12,
      y: 22,
      width: 196,
      height: 96,
    });
  });

  it("applies inset and scale together", () => {
    stubUiScale("2");
    const rect = makeDOMRect(10, 20, 200, 100);
    expect(toNativeFrame(rect, 5)).toEqual({
      x: Math.round((10 + 5) * 2),
      y: Math.round((20 + 5) * 2),
      width: Math.round((200 - 10) * 2),
      height: Math.round((100 - 10) * 2),
    });
  });

  it("rounds results to nearest integer", () => {
    stubUiScale("0.75");
    const rect = makeDOMRect(1, 1, 10, 10);
    const result = toNativeFrame(rect);
    expect(Number.isInteger(result.x)).toBe(true);
    expect(Number.isInteger(result.y)).toBe(true);
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
  });

  it("defaults to scale=1 when --ui-scale is empty", () => {
    stubUiScale("");
    const rect = makeDOMRect(50, 60, 400, 300);
    expect(toNativeFrame(rect)).toEqual({
      x: 50,
      y: 60,
      width: 400,
      height: 300,
    });
  });

  it("defaults inset to 0 when not provided", () => {
    stubUiScale("1");
    const rect = makeDOMRect(0, 0, 100, 50);
    expect(toNativeFrame(rect)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it("handles scale=1.5 correctly", () => {
    stubUiScale("1.5");
    const rect = makeDOMRect(20, 30, 100, 80);
    expect(toNativeFrame(rect, 0)).toEqual({
      x: Math.round(20 * 1.5),
      y: Math.round(30 * 1.5),
      width: Math.round(100 * 1.5),
      height: Math.round(80 * 1.5),
    });
  });
});
