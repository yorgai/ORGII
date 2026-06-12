/**
 * Unit tests for the pure utility functions in apiTrackerUtils.ts.
 *
 * Covers:
 *   - INTERNAL_FUNCTIONS / TAURI_INTERNAL_FUNCTIONS sets contain expected entries
 *   - extractFileInfo — Safari/Firefox and Chrome stack-trace parsing
 *   - generateRequestId — format and uniqueness
 *
 * getApiStack / getTauriStack generate live Error stacks which are
 * environment-dependent and not deterministically testable in isolation;
 * we skip those and note the reason.
 *
 * getComponentInfo depends on a live DOM hover tracker and is also skipped.
 */
import { describe, expect, it } from "vitest";

import {
  INTERNAL_FUNCTIONS,
  TAURI_INTERNAL_FUNCTIONS,
  extractFileInfo,
  generateRequestId,
} from "../apiTrackerUtils";

// ---------------------------------------------------------------------------
// INTERNAL_FUNCTIONS set
// ---------------------------------------------------------------------------

describe("INTERNAL_FUNCTIONS set", () => {
  it("includes React internal names", () => {
    expect(INTERNAL_FUNCTIONS.has("renderWithHooks")).toBe(true);
    expect(INTERNAL_FUNCTIONS.has("performUnitOfWork")).toBe(true);
    expect(INTERNAL_FUNCTIONS.has("workLoopSync")).toBe(true);
  });

  it("includes Jotai hook names", () => {
    expect(INTERNAL_FUNCTIONS.has("useAtomValue")).toBe(true);
    expect(INTERNAL_FUNCTIONS.has("useAtom")).toBe(true);
    expect(INTERNAL_FUNCTIONS.has("useSetAtom")).toBe(true);
  });

  it("includes axios/API layer names", () => {
    expect(INTERNAL_FUNCTIONS.has("axios")).toBe(true);
    expect(INTERNAL_FUNCTIONS.has("makeRequest")).toBe(true);
    expect(INTERNAL_FUNCTIONS.has("captureApiCallStack")).toBe(true);
  });
});

describe("TAURI_INTERNAL_FUNCTIONS set", () => {
  it("is a superset of INTERNAL_FUNCTIONS", () => {
    for (const fn of INTERNAL_FUNCTIONS) {
      expect(TAURI_INTERNAL_FUNCTIONS.has(fn)).toBe(true);
    }
  });

  it("additionally contains Tauri-specific names", () => {
    expect(TAURI_INTERNAL_FUNCTIONS.has("invokeTauri")).toBe(true);
    expect(TAURI_INTERNAL_FUNCTIONS.has("invoke")).toBe(true);
    expect(TAURI_INTERNAL_FUNCTIONS.has("trackTauriInvoke")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractFileInfo
// ---------------------------------------------------------------------------

describe("extractFileInfo — Chrome stack format", () => {
  it("extracts function name and src path from a typical Chrome frame", () => {
    const stack =
      "    at handleSubmit (https://localhost:3000/src/modules/Foo/index.tsx:42:15)\n" +
      "    at onClick (https://localhost:3000/src/modules/Bar/button.tsx:10:5)";
    const result = extractFileInfo(stack);
    expect(result.functionName).toBe("handleSubmit");
    expect(result.filePath).toBe("src/modules/Foo/index.tsx");
    expect(result.lineNumber).toBe(42);
  });

  it("derives componentName from filename when path is present", () => {
    const stack =
      "    at MyComponent (https://localhost:3000/src/components/MyComponent/index.tsx:5:3)";
    const result = extractFileInfo(stack);
    expect(result.componentName).toBe("MyComponent");
  });

  it("uses function name as componentName when no path matches", () => {
    const stack = "    at someFn (eval:1:1)";
    const result = extractFileInfo(stack);
    // No src/ path → componentName = functionName
    expect(result.componentName).toBe("someFn");
  });
});

describe("extractFileInfo — Safari/Firefox stack format", () => {
  it("extracts function name and src path from a typical Safari frame", () => {
    const stack =
      "handleSubmit@https://localhost:3000/src/modules/Foo/index.tsx:42:15\n" +
      "onClick@https://localhost:3000/src/modules/Bar/button.tsx:10:5";
    const result = extractFileInfo(stack);
    expect(result.functionName).toBe("handleSubmit");
    expect(result.filePath).toBe("src/modules/Foo/index.tsx");
    expect(result.lineNumber).toBe(42);
  });
});

describe("extractFileInfo — empty / malformed input", () => {
  it("returns an empty object for an empty string", () => {
    const result = extractFileInfo("");
    expect(result).toEqual({});
  });

  it("returns an empty object for a stack with no src/ paths", () => {
    const result = extractFileInfo(
      "Error\n    at eval:1:1\n    at node_modules/foo:1:1"
    );
    expect(result).toEqual({});
  });

  it("does not throw on garbage input", () => {
    expect(() => extractFileInfo("not a stack trace at all!!!")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generateRequestId
// ---------------------------------------------------------------------------

describe("generateRequestId", () => {
  it("returns a non-empty string", () => {
    expect(typeof generateRequestId()).toBe("string");
    expect(generateRequestId().length).toBeGreaterThan(0);
  });

  it("includes a timestamp prefix (starts with digits)", () => {
    const id = generateRequestId();
    const parts = id.split("-");
    expect(Number.isFinite(Number(parts[0]))).toBe(true);
  });

  it("generates unique IDs across multiple calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});

// NOTE: getApiStack, getTauriStack, and getComponentInfo depend on live Error
// stacks and DOM hover state respectively. They are excluded from unit tests —
// cover them with integration/E2E tests instead.
