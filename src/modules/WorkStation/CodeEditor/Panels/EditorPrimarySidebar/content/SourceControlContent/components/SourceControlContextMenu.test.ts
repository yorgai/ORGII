import { describe, expect, it, vi } from "vitest";

import type { GitFile } from "@src/types/git/types";

import {
  getSourceControlContextMenuActionLabels,
  resolveConflictsForFiles,
} from "./SourceControlContextMenu";

function gitFile(path: string): GitFile {
  return {
    id: path,
    path,
    status: "modified",
    staged: false,
    additions: 0,
    deletions: 0,
  };
}

describe("getSourceControlContextMenuActionLabels", () => {
  it("keeps existing single-file labels", () => {
    expect(
      getSourceControlContextMenuActionLabels({
        isDirectory: false,
        isStaged: false,
        changeCount: 1,
      })
    ).toMatchObject({
      stageToggle: "Stage Changes",
      markResolved: "Mark as Resolved (Stage)",
      discard: "Discard Changes",
    });
  });

  it("shows singular folder change counts", () => {
    expect(
      getSourceControlContextMenuActionLabels({
        isDirectory: true,
        isStaged: false,
        changeCount: 1,
      })
    ).toMatchObject({
      stageToggle: "Stage 1 change",
      markResolved: "Mark 1 change as Resolved",
      discard: "Discard 1 change",
    });
  });

  it("shows plural folder change counts", () => {
    expect(
      getSourceControlContextMenuActionLabels({
        isDirectory: true,
        isStaged: true,
        changeCount: 3,
      })
    ).toMatchObject({
      stageToggle: "Unstage 3 changes",
      markResolved: "Mark 3 changes as Resolved",
      discard: "Discard 3 changes",
    });
  });
});

describe("resolveConflictsForFiles", () => {
  it("dispatches conflict resolution for every file in a folder", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await resolveConflictsForFiles(
      dispatch,
      [gitFile("src/a.ts"), gitFile("src/b.ts")],
      "ours"
    );

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      "git.resolveConflict",
      { path: "src/a.ts", strategy: "ours" },
      "user"
    );
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      "git.resolveConflict",
      { path: "src/b.ts", strategy: "ours" },
      "user"
    );
  });
});
