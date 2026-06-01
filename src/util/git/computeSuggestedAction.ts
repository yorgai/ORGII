/**
 * Compute Suggested Git Action
 *
 * Locally computes the suggested git action from status.
 * This avoids an extra API call - the logic is pure computation.
 *
 * Priority order:
 * 1. Conflicts exist -> commit (to resolve)
 * 2. Rebase/cherry-pick in progress -> commit (continue)
 * 3. Behind remote -> pull
 * 4. Uncommitted changes -> commit
 * 5. Ahead of remote -> push
 * 6. No upstream -> publish_branch
 * 7. Clean -> none
 */
import type { GitStatusData } from "@src/api/http/git";
import type { GitSuggestedAction } from "@src/types/session/steps";

// Accept either GitStatusData (from API) or similar shape
type StatusInput = GitStatusData | null | undefined;

export function computeSuggestedAction(
  status: StatusInput
): GitSuggestedAction | null {
  if (!status) return null;

  // 1. Check for conflicts - suggest commit (to resolve conflicts)
  if (status.do_conflicted_files_exist) {
    const conflictCount =
      status.working_directory?.files?.filter((f) => f.status === "U").length ??
      0;

    return {
      action: "commit",
      reason: "Resolve merge conflicts and commit",
      description: "Conflicted files need resolution",
      details: {
        conflict_count: conflictCount,
      },
    };
  }

  // 2. Check for in-progress operations - suggest commit to continue
  if (status.rebase_in_progress) {
    return {
      action: "commit",
      reason: "Continue rebase after resolving conflicts",
      description: "Rebase operation in progress",
      details: {},
    };
  }

  if (status.cherry_pick_in_progress) {
    return {
      action: "commit",
      reason: "Continue cherry-pick after resolving conflicts",
      description: "Cherry-pick operation in progress",
      details: {},
    };
  }

  // 3. Check behind remote (pull needed)
  const behind = status.branch_ahead_behind?.behind ?? 0;
  const ahead = status.branch_ahead_behind?.ahead ?? 0;

  if (behind > 0) {
    const upstream =
      status.current_upstream_branch || `origin/${status.current_branch}`;
    return {
      action: "pull",
      reason: "Pull latest changes from remote",
      description: `Download from ${upstream} to ${status.current_branch}`,
      details: {
        ahead_count: ahead,
        behind_count: behind,
        upstream,
      },
    };
  }

  // 4. Check for uncommitted changes
  const stagedCount = status.working_directory?.staged_count ?? 0;
  const unstagedCount = status.working_directory?.unstaged_count ?? 0;
  const untrackedCount = status.working_directory?.untracked_count ?? 0;
  const filesCount = stagedCount + unstagedCount + untrackedCount;
  const filesFromArray = status.working_directory?.files?.length ?? 0;
  const totalChanges = filesCount > 0 ? filesCount : filesFromArray;

  if (totalChanges > 0) {
    return {
      action: "commit",
      reason: "Review your changes",
      description: `Save your work to ${status.current_branch}`,
      details: {
        files_count: totalChanges,
        branch: status.current_branch,
      },
    };
  }

  // 5. Check ahead of remote (push needed)
  if (ahead > 0) {
    const upstream =
      status.current_upstream_branch || `origin/${status.current_branch}`;
    return {
      action: "push",
      reason: "Push commits to remote",
      description: `Upload ${status.current_branch} to ${upstream}`,
      details: {
        ahead_count: ahead,
        behind_count: behind,
        upstream,
      },
    };
  }

  // 6. Check if no upstream (publish branch)
  if (!status.current_upstream_branch && status.exists) {
    return {
      action: "publish_branch",
      reason: "Publish branch to remote",
      description: `Create remote tracking for ${status.current_branch}`,
      details: {
        branch: status.current_branch,
      },
    };
  }

  // 7. Everything is clean
  return {
    action: "none",
    reason: "Working tree is clean",
    details: {
      files_count: 0,
      ahead_count: ahead,
      behind_count: behind,
      conflict_count: 0,
    },
  };
}
