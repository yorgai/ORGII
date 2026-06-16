import { describe, expect, it } from "vitest";

import type { SimulatorDiffScopeRequest } from "@src/store/ui/simulatorAtom";

import {
  type DiffScopeItemLike,
  filterDiffSectionsByScope,
  isDiffScopeActive,
  resolveScopedSelectedPath,
} from "../diffScope";

function createScope(
  overrides?: Partial<SimulatorDiffScopeRequest>
): SimulatorDiffScopeRequest {
  return {
    sessionId: "session-1",
    turnId: "turn-1",
    filePaths: ["src/a.ts", "src/b.ts"],
    selectedPath: null,
    nonce: 1,
    ...overrides,
  };
}

function item(path: string): DiffScopeItemLike {
  return { file: { path } };
}

const SECTIONS: DiffScopeItemLike[] = [
  item("src/a.ts"),
  item("src/b.ts"),
  item("src/c.ts"),
];

describe("isDiffScopeActive", () => {
  it("is inactive when scope is null", () => {
    expect(isDiffScopeActive(null, "session-1")).toBe(false);
  });

  it("is inactive when scope is undefined", () => {
    expect(isDiffScopeActive(undefined, "session-1")).toBe(false);
  });

  it("is inactive for an empty path set", () => {
    expect(isDiffScopeActive(createScope({ filePaths: [] }), "session-1")).toBe(
      false
    );
  });

  it("is active for a matching session", () => {
    expect(isDiffScopeActive(createScope(), "session-1")).toBe(true);
  });

  it("is inactive when the scope's session differs from the current one", () => {
    expect(isDiffScopeActive(createScope(), "session-2")).toBe(false);
  });

  it("is active when the scope declares no session (session-agnostic)", () => {
    expect(
      isDiffScopeActive(createScope({ sessionId: null }), "session-2")
    ).toBe(true);
  });

  it("is active when the current session is not yet resolved", () => {
    expect(isDiffScopeActive(createScope(), null)).toBe(true);
    expect(isDiffScopeActive(createScope(), undefined)).toBe(true);
  });
});

describe("filterDiffSectionsByScope", () => {
  it("returns the full list (copy) when scope is inactive", () => {
    const result = filterDiffSectionsByScope(SECTIONS, null, "session-1");
    expect(result).toHaveLength(3);
    expect(result).not.toBe(SECTIONS);
  });

  it("narrows to a single scoped file", () => {
    const scope = createScope({ filePaths: ["src/b.ts"] });
    const result = filterDiffSectionsByScope(SECTIONS, scope, "session-1");
    expect(result.map((s) => s.file.path)).toEqual(["src/b.ts"]);
  });

  it("narrows to multiple scoped files preserving list order", () => {
    const scope = createScope({ filePaths: ["src/c.ts", "src/a.ts"] });
    const result = filterDiffSectionsByScope(SECTIONS, scope, "session-1");
    expect(result.map((s) => s.file.path)).toEqual(["src/a.ts", "src/c.ts"]);
  });

  it("falls back to the full list when no scoped path is present (reverted)", () => {
    const scope = createScope({ filePaths: ["src/gone.ts"] });
    const result = filterDiffSectionsByScope(SECTIONS, scope, "session-1");
    expect(result.map((s) => s.file.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("does not filter when the session mismatches (full diff)", () => {
    const result = filterDiffSectionsByScope(SECTIONS, createScope(), "other");
    expect(result).toHaveLength(3);
  });

  it("returns an empty array when the source list is empty", () => {
    expect(filterDiffSectionsByScope([], createScope(), "session-1")).toEqual(
      []
    );
  });
});

describe("resolveScopedSelectedPath", () => {
  it("returns null when scope is inactive", () => {
    expect(resolveScopedSelectedPath(null, "session-1")).toBeNull();
  });

  it("returns null for the bare Review case (no selected path)", () => {
    expect(resolveScopedSelectedPath(createScope(), "session-1")).toBeNull();
  });

  it("returns the selected path when it belongs to the scope set", () => {
    const scope = createScope({ selectedPath: "src/b.ts" });
    expect(resolveScopedSelectedPath(scope, "session-1")).toBe("src/b.ts");
  });

  it("ignores a selected path that is not part of the scope set", () => {
    const scope = createScope({ selectedPath: "src/z.ts" });
    expect(resolveScopedSelectedPath(scope, "session-1")).toBeNull();
  });

  it("returns null when the session mismatches", () => {
    const scope = createScope({ selectedPath: "src/b.ts" });
    expect(resolveScopedSelectedPath(scope, "session-2")).toBeNull();
  });
});
