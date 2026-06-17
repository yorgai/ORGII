import { describe, expect, it } from "vitest";

import type { WorkStationTab } from "@src/store/workstation/tabs/types";
import type { GitFile } from "@src/types/git/types";

import { resolveGitDiffSelection } from "../sourceControlSelection";

function createGitFile(overrides: Partial<GitFile> = {}): GitFile {
  return {
    id: "src/index.ts-0",
    path: "src/index.ts",
    status: "modified",
    additions: 0,
    deletions: 0,
    staged: false,
    original_path: null,
    ...overrides,
  };
}

function allChangesTab(): WorkStationTab {
  return {
    type: "source-control",
    data: { mode: "all-changes" },
  } as unknown as WorkStationTab;
}

function focusTab(): WorkStationTab {
  return {
    type: "source-control",
    data: { mode: "focus" },
  } as unknown as WorkStationTab;
}

describe("resolveGitDiffSelection", () => {
  const repoPath = "/Users/me/repo";

  it("builds an absolute path from a relative file path", () => {
    const result = resolveGitDiffSelection(
      createGitFile({ path: "src/index.ts" }),
      repoPath,
      allChangesTab()
    );
    expect(result.absolutePath).toBe("/Users/me/repo/src/index.ts");
    expect(result.relativePath).toBe("src/index.ts");
    expect(result.effectiveRepoPath).toBe(repoPath);
  });

  it("keeps an already-absolute path and derives the relative path", () => {
    const result = resolveGitDiffSelection(
      createGitFile({ path: "/Users/me/repo/src/a.ts" }),
      repoPath,
      allChangesTab()
    );
    expect(result.absolutePath).toBe("/Users/me/repo/src/a.ts");
    expect(result.relativePath).toBe("src/a.ts");
  });

  it("prefers the file's own repoRoot over the host repo path (worktrees)", () => {
    const worktreeRoot = "/Users/me/repo/.worktrees/feature";
    const result = resolveGitDiffSelection(
      createGitFile({ path: "lib/x.ts", repoRoot: worktreeRoot }),
      repoPath,
      allChangesTab()
    );
    expect(result.effectiveRepoPath).toBe(worktreeRoot);
    expect(result.absolutePath).toBe(`${worktreeRoot}/lib/x.ts`);
  });

  it("flags the all-changes view only for source-control + all-changes mode", () => {
    expect(
      resolveGitDiffSelection(createGitFile(), repoPath, allChangesTab())
        .isAllChangesView
    ).toBe(true);
    expect(
      resolveGitDiffSelection(createGitFile(), repoPath, focusTab())
        .isAllChangesView
    ).toBe(false);
  });

  it("treats null/undefined active tab as not the all-changes view", () => {
    expect(
      resolveGitDiffSelection(createGitFile(), repoPath, null).isAllChangesView
    ).toBe(false);
    expect(
      resolveGitDiffSelection(createGitFile(), repoPath, undefined)
        .isAllChangesView
    ).toBe(false);
  });

  it("is pure: identical inputs yield equal output regardless of which active tab object instance is passed (ref stability backing)", () => {
    const file = createGitFile();
    const a = resolveGitDiffSelection(file, repoPath, allChangesTab());
    const b = resolveGitDiffSelection(file, repoPath, allChangesTab());
    expect(a).toEqual(b);
  });
});
