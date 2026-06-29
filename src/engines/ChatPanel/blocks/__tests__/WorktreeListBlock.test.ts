import { describe, expect, it } from "vitest";

import {
  buildWorktreeRows,
  extractWorktreeEntries,
  unwrapWorktreeResult,
} from "../WorktreeListBlock";

describe("WorktreeListBlock helpers", () => {
  it("extracts list entries from direct result objects", () => {
    expect(
      extractWorktreeEntries({
        entries: [
          { path: "/repo", branch: "develop" },
          { path: "/repo/.orgii/worktrees/fix", branch: "fix/example" },
        ],
      })
    ).toEqual([
      { path: "/repo", branch: "develop" },
      { path: "/repo/.orgii/worktrees/fix", branch: "fix/example" },
    ]);
  });

  it("extracts list entries from output JSON wrappers", () => {
    expect(
      extractWorktreeEntries({
        output: JSON.stringify({
          entries: [{ path: "/repo", branch: "develop" }],
        }),
      })
    ).toEqual([{ path: "/repo", branch: "develop" }]);
  });

  it("unwraps output JSON while preserving wrapper fields", () => {
    expect(
      unwrapWorktreeResult({
        output: JSON.stringify({ path: "/worktree", branch: "fix/a" }),
        success: true,
      })
    ).toMatchObject({ path: "/worktree", branch: "fix/a", success: true });
  });

  it("builds structured rows for failed add calls", () => {
    const rows = buildWorktreeRows(
      "add",
      {
        action: "add",
        branch: "fix/issue-173-rewind-redo-tool",
        base_ref: "origin/develop",
      },
      {
        success: false,
        content: "Already in a worktree. Leave first before adding another.",
      }
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        { key: "action", label: "Action", value: "add" },
        {
          key: "branch",
          label: "Branch",
          value: "fix/issue-173-rewind-redo-tool",
        },
        { key: "base", label: "Base", value: "origin/develop" },
        {
          key: "message",
          label: "Error",
          value: "Already in a worktree. Leave first before adding another.",
        },
      ])
    );
  });

  it("builds structured rows for leave calls", () => {
    const rows = buildWorktreeRows(
      "leave",
      { action: "leave", remove: false },
      {
        success: true,
        path: "/repo/.orgii/worktrees/fix",
        branch: "fix/a",
        removed: false,
      }
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        { key: "action", label: "Action", value: "leave" },
        { key: "branch", label: "Branch", value: "fix/a" },
        { key: "path", label: "Path", value: "/repo/.orgii/worktrees/fix" },
        { key: "remove", label: "Remove directory", value: "false" },
        { key: "removed", label: "Removed", value: "false" },
      ])
    );
  });
});
