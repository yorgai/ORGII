/**
 * Unit tests for the pure helpers in imageOptimizer.ts.
 *
 * We test:
 *   - IMAGE_LIMITS constants
 *   - formatBytes — human-readable size strings
 *
 * calculateNewDimensions and getBase64Size are private (not exported), so
 * we test them indirectly through the exported constants and formatBytes.
 * The Canvas-dependent optimizeImage is not testable without a browser DOM
 * and is therefore skipped (noted below).
 */
import { describe, expect, it } from "vitest";

import { IMAGE_LIMITS, formatBytes } from "../imageOptimizer";

// ---------------------------------------------------------------------------
// IMAGE_LIMITS constants
// ---------------------------------------------------------------------------

describe("IMAGE_LIMITS constants", () => {
  it("MAX_FILE_SIZE is 20 MB", () => {
    expect(IMAGE_LIMITS.MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
  });

  it("WARNING_FILE_SIZE is 5 MB", () => {
    expect(IMAGE_LIMITS.WARNING_FILE_SIZE).toBe(5 * 1024 * 1024);
  });

  it("MAX_DIMENSION is 8192", () => {
    expect(IMAGE_LIMITS.MAX_DIMENSION).toBe(8192);
  });

  it("RECOMMENDED_MAX_DIMENSION is 4096", () => {
    expect(IMAGE_LIMITS.RECOMMENDED_MAX_DIMENSION).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes less than 1 KB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats exactly 1 KB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats kilobytes range", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(500 * 1024)).toBe("500.0 KB");
  });

  it("formats exactly 1 MB", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("formats megabytes range", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20.0 MB");
  });

  it("handles fractional MB", () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});

// NOTE: optimizeImage, calculateNewDimensions, compressImage, and loadImage
// all require a browser Canvas / URL API and cannot be unit-tested without
// jsdom or a real browser environment. They are excluded from this test file.
// Cover them with E2E or integration tests instead.
