/**
 * Git Branch Actions (Zod-based)
 *
 * Actions for checkout, create branch, merge abort, and rebase abort.
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { gitCreateBranch } from "@src/api/http/git";
import { GitOperationsService, GitService } from "@src/services/git";

// ============================================
// Checkout Actions
// ============================================

export const gitCheckout = defineZodAction(
  {
    id: ACTION_ID.GIT_CHECKOUT,
    category: "git",
    layer: "action",
    description: "Checkout a branch",
    params: z.object({
      branch: z
        .string()
        .min(1, "Branch name cannot be empty")
        .describe("Branch name"),
      create: z
        .boolean()
        .optional()
        .default(false)
        .describe("Create new branch"),
    }),
    examples: ["checkout main", "switch to develop", "create branch feature/x"],
  },
  async ({ branch, create }) => {
    const result = await GitOperationsService.checkoutWithDialog(
      branch,
      create
    );
    return {
      success: result.success,
      message: result.success
        ? `Checked out: ${branch}`
        : result.message || "Failed to checkout",
      data: { branch, created: create, errorType: result.errorType },
    };
  }
);

// ============================================
// Create Branch From Commit
// ============================================

export const gitCreateBranchFromCommit = defineZodAction(
  {
    id: ACTION_ID.GIT_CREATE_BRANCH_FROM_COMMIT,
    category: "git",
    layer: "action",
    description: "Create a new branch from a specific commit",
    params: z.object({
      branchName: z.string().min(1, "Branch name is required"),
      commitSha: z.string().min(7, "Commit SHA is required"),
      checkout: z
        .boolean()
        .optional()
        .default(true)
        .describe("Checkout the branch after creation"),
    }),
    requiresConfirmation: true,
    examples: ["create branch fix-x from abc1234", "branch from commit"],
  },
  async ({ branchName, commitSha, checkout }) => {
    const repo = GitService.getRepoContext();
    if (!repo) {
      return {
        success: false,
        message: "No active repo selected",
      };
    }

    const created = await gitCreateBranch({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      name: branchName,
      start_point: commitSha,
      checkout,
    });

    if (!created) {
      return {
        success: false,
        message: "Failed to create branch from commit",
      };
    }

    return {
      success: true,
      message: checkout
        ? `Created and checked out ${branchName}`
        : `Created branch ${branchName}`,
      data: {
        branchName,
        commitSha,
        checkout,
      },
    };
  }
);

// ============================================
// Merge & Rebase Abort Actions
// ============================================

export const gitMergeAbort = defineZodAction(
  {
    id: ACTION_ID.GIT_MERGE_ABORT,
    category: "git",
    layer: "action",
    description: "Abort a merge operation",
    params: z.object({}),
    examples: ["abort merge", "git merge --abort"],
  },
  async () => {
    const result = await GitOperationsService.mergeAbort();
    return {
      success: result.success,
      message: result.success
        ? "Merge aborted"
        : result.message || "Failed to abort merge",
      data: { errorType: result.errorType },
    };
  }
);

export const gitRebaseAbort = defineZodAction(
  {
    id: ACTION_ID.GIT_REBASE_ABORT,
    category: "git",
    layer: "action",
    description: "Abort a rebase operation",
    params: z.object({}),
    examples: ["abort rebase", "git rebase --abort"],
  },
  async () => {
    const result = await GitOperationsService.rebaseAbort();
    return {
      success: result.success,
      message: result.success
        ? "Rebase aborted"
        : result.message || "Failed to abort rebase",
      data: { errorType: result.errorType },
    };
  }
);
