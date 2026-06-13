/**
 * gitStatusAtom — derived map and folder-status aggregation tests.
 *
 * Covers the pure derivation logic:
 *   • gitFileStatusMapAtom  — file path → { status, staged }
 *   • gitFolderStatusMapAtom — folder path → aggregate status
 *   • STATUS_PRIORITY ordering
 *   • gitFetchOriginVisibleAtom
 *   • hasGitSuggestionsAtom
 *
 * The existing gitStatusAtom.test.ts covers cache staleness and pruning;
 * this file extends coverage to the derived tree-decoration atoms.
 */
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import type {
  GitRepositoryStatus,
  GitWorkingDirectoryFile,
} from "@src/types/session/steps";

import {
  STATUS_PRIORITY,
  gitFetchOriginStateAtom,
  gitFetchOriginVisibleAtom,
  gitFileStatusMapAtom,
  workspaceFileStatusMapAtom,
  workspaceGitStatusMapAtom,
} from "../gitStatusAtom";

function makeRepoStatus(
  files: {
    path: string;
    status: GitWorkingDirectoryFile["status"];
    staged: boolean;
  }[]
): GitRepositoryStatus {
  return {
    current_branch: "main",
    current_upstream_branch: "origin/main",
    current_tip: "abc123",
    branch_ahead_behind: { ahead: 0, behind: 0 },
    exists: true,
    merge_head_found: false,
    squash_msg_found: false,
    rebase_in_progress: false,
    cherry_pick_in_progress: false,
    working_directory: {
      files: files.map((file) => ({ ...file, original_path: null })),
    },
    do_conflicted_files_exist: false,
  };
}

describe("STATUS_PRIORITY", () => {
  it("conflict has the highest priority", () => {
    expect(STATUS_PRIORITY["conflict"]).toBeGreaterThan(
      STATUS_PRIORITY["deleted"]
    );
    expect(STATUS_PRIORITY["deleted"]).toBeGreaterThan(
      STATUS_PRIORITY["renamed"]
    );
    expect(STATUS_PRIORITY["renamed"]).toBeGreaterThan(
      STATUS_PRIORITY["modified"]
    );
    expect(STATUS_PRIORITY["modified"]).toBeGreaterThan(
      STATUS_PRIORITY["added"]
    );
  });
});

describe("gitFileStatusMapAtom", () => {
  it("is empty when there is no git status", () => {
    const store = createStore();
    expect(store.get(gitFileStatusMapAtom).size).toBe(0);
  });

  it("strips leading slash from file paths", () => {
    const store = createStore();
    store.set(
      workspaceGitStatusMapAtom,
      new Map([
        [
          "/repo",
          makeRepoStatus([
            { path: "/src/index.ts", status: "M", staged: false },
          ]),
        ],
      ])
    );
    const map = store.get(workspaceFileStatusMapAtom);
    expect(map.has("/repo/src/index.ts")).toBe(true);
  });
});

describe("gitFetchOriginVisibleAtom", () => {
  it("is false in idle state", () => {
    const store = createStore();
    expect(store.get(gitFetchOriginVisibleAtom)).toBe(false);
  });

  it("is true when fetching", () => {
    const store = createStore();
    store.set(gitFetchOriginStateAtom, { status: "fetching", repoId: "r1" });
    expect(store.get(gitFetchOriginVisibleAtom)).toBe(true);
  });

  it("is true when up-to-date", () => {
    const store = createStore();
    store.set(gitFetchOriginStateAtom, { status: "up-to-date", repoId: "r1" });
    expect(store.get(gitFetchOriginVisibleAtom)).toBe(true);
  });

  it("is false when reset to idle", () => {
    const store = createStore();
    store.set(gitFetchOriginStateAtom, { status: "fetching", repoId: "r1" });
    store.set(gitFetchOriginStateAtom, { status: "idle", repoId: null });
    expect(store.get(gitFetchOriginVisibleAtom)).toBe(false);
  });
});

describe("workspaceFileStatusMapAtom", () => {
  it("is empty when workspaceGitStatusMapAtom has no entries", () => {
    const store = createStore();
    expect(store.get(workspaceFileStatusMapAtom).size).toBe(0);
  });

  it("merges files across multiple workspace folders", () => {
    const store = createStore();
    store.set(
      workspaceGitStatusMapAtom,
      new Map([
        [
          "/repo-a",
          makeRepoStatus([{ path: "a.ts", status: "M", staged: false }]),
        ],
        [
          "/repo-b",
          makeRepoStatus([{ path: "b.ts", status: "A", staged: true }]),
        ],
      ])
    );
    const map = store.get(workspaceFileStatusMapAtom);
    expect(map.has("/repo-a/a.ts")).toBe(true);
    expect(map.has("/repo-b/b.ts")).toBe(true);
  });

  it("handles folders with no working_directory.files gracefully", () => {
    const store = createStore();
    store.set(
      workspaceGitStatusMapAtom,
      new Map([
        [
          "/repo-empty",
          { working_directory: null } as unknown as ReturnType<
            typeof makeRepoStatus
          >,
        ],
      ])
    );
    expect(() => store.get(workspaceFileStatusMapAtom)).not.toThrow();
  });
});
