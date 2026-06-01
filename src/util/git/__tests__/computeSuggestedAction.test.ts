import type { GitStatusData } from "@src/api/http/git";

import { computeSuggestedAction } from "../computeSuggestedAction";

function statusFixture(partial: Partial<GitStatusData>): GitStatusData {
  return partial as GitStatusData;
}

describe("computeSuggestedAction", () => {
  it("returns null for null input", () => {
    expect(computeSuggestedAction(null)).toBe(null);
  });

  it("returns null for undefined input", () => {
    expect(computeSuggestedAction(undefined)).toBe(null);
  });

  it("returns commit when conflicts exist", () => {
    const result = computeSuggestedAction(
      statusFixture({
        do_conflicted_files_exist: true,
        working_directory: {
          files: [
            {
              path: "conflict.ts",
              status: "U",
              staged: false,
              original_path: null,
            },
          ],
        },
        current_branch: "main",
      })
    );
    expect(result?.action).toBe("commit");
  });

  it("returns commit when rebase is in progress", () => {
    const result = computeSuggestedAction(
      statusFixture({
        rebase_in_progress: true,
        current_branch: "main",
      })
    );
    expect(result?.action).toBe("commit");
  });

  it("returns commit when cherry-pick is in progress", () => {
    const result = computeSuggestedAction(
      statusFixture({
        cherry_pick_in_progress: true,
        current_branch: "main",
      })
    );
    expect(result?.action).toBe("commit");
  });

  it("returns pull when behind remote", () => {
    const result = computeSuggestedAction(
      statusFixture({
        branch_ahead_behind: { behind: 3, ahead: 0 },
        current_branch: "main",
        current_upstream_branch: "origin/main",
        working_directory: {
          files: [],
          staged_count: 0,
          unstaged_count: 0,
          untracked_count: 0,
        },
      })
    );
    expect(result?.action).toBe("pull");
  });

  it("returns commit when there are uncommitted changes", () => {
    const result = computeSuggestedAction(
      statusFixture({
        working_directory: {
          files: [],
          staged_count: 2,
          unstaged_count: 0,
          untracked_count: 0,
        },
        branch_ahead_behind: { behind: 0, ahead: 0 },
        current_branch: "main",
      })
    );
    expect(result?.action).toBe("commit");
  });

  it("returns push when ahead of remote", () => {
    const result = computeSuggestedAction(
      statusFixture({
        branch_ahead_behind: { ahead: 2, behind: 0 },
        working_directory: {
          files: [],
          staged_count: 0,
          unstaged_count: 0,
          untracked_count: 0,
        },
        current_branch: "feat",
        current_upstream_branch: "origin/feat",
      })
    );
    expect(result?.action).toBe("push");
  });

  it("returns publish_branch when there is no upstream", () => {
    const result = computeSuggestedAction(
      statusFixture({
        current_upstream_branch: null,
        exists: true,
        branch_ahead_behind: { ahead: 0, behind: 0 },
        working_directory: {
          files: [],
          staged_count: 0,
          unstaged_count: 0,
          untracked_count: 0,
        },
        current_branch: "new-branch",
      })
    );
    expect(result?.action).toBe("publish_branch");
  });

  it("returns none when clean with upstream", () => {
    const result = computeSuggestedAction(
      statusFixture({
        branch_ahead_behind: { ahead: 0, behind: 0 },
        working_directory: {
          files: [],
          staged_count: 0,
          unstaged_count: 0,
          untracked_count: 0,
        },
        current_upstream_branch: "origin/main",
        current_branch: "main",
        exists: true,
      })
    );
    expect(result?.action).toBe("none");
  });

  it("prefers commit for conflicts over behind remote", () => {
    const result = computeSuggestedAction(
      statusFixture({
        do_conflicted_files_exist: true,
        working_directory: {
          files: [
            {
              path: "conflict.ts",
              status: "U",
              staged: false,
              original_path: null,
            },
          ],
          staged_count: 0,
          unstaged_count: 0,
          untracked_count: 0,
        },
        branch_ahead_behind: { behind: 5, ahead: 0 },
        current_branch: "main",
        current_upstream_branch: "origin/main",
      })
    );
    expect(result?.action).toBe("commit");
  });
});
