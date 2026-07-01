import { describe, expect, it } from "vitest";

import {
  reconcileSourceControlScope,
  scopesEqual,
} from "../../tabs/sourceControlScopePickerHelpers";

describe("scopesEqual", () => {
  it("treats two local scopes as equal", () => {
    expect(scopesEqual({ kind: "local" }, { kind: "local" })).toBe(true);
  });

  it("compares worktree paths", () => {
    expect(
      scopesEqual(
        { kind: "worktree", path: "/tmp/a" },
        { kind: "worktree", path: "/tmp/a" }
      )
    ).toBe(true);
    expect(
      scopesEqual(
        { kind: "worktree", path: "/tmp/a" },
        { kind: "worktree", path: "/tmp/b" }
      )
    ).toBe(false);
  });
});

describe("reconcileSourceControlScope persistence edge cases", () => {
  it("preserves local scope regardless of worktree list", () => {
    expect(
      reconcileSourceControlScope({ kind: "local" }, [], {
        worktreesReady: true,
      })
    ).toEqual({ kind: "local" });
  });
});
