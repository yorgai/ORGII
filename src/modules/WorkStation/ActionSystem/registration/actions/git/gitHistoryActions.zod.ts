/**
 * Git History Actions (Zod-based)
 *
 * Actions for amend, cherry-pick, revert, reset, and conflict resolution.
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import {
  type ResetMode,
  gitCherryPick,
  gitReset,
  gitRevert,
} from "@src/api/http/git";
import { GitOperationsService, GitService } from "@src/services/git";

export const gitAmend = defineZodAction(
  {
    id: ACTION_ID.GIT_AMEND,
    category: "git",
    layer: "action",
    description: "Amend the last commit",
    params: z.object({
      message: z
        .string()
        .optional()
        .describe(
          "New commit message (optional, keeps old message if not provided)"
        ),
    }),
    requiresConfirmation: true,
    examples: ["amend commit", "git commit --amend"],
  },
  async ({ message }) => {
    const result = await GitOperationsService.amend(message);
    return {
      success: result.success,
      message: result.success
        ? "Commit amended"
        : result.message || "Failed to amend commit",
      data: { newMessage: message, errorType: result.errorType },
    };
  }
);

export const gitCherryPickCommit = defineZodAction(
  {
    id: ACTION_ID.GIT_CHERRY_PICK_COMMIT,
    category: "git",
    layer: "action",
    description: "Cherry-pick a commit onto current branch",
    params: z.object({
      commitSha: z.string().min(7, "Commit SHA is required"),
      noCommit: z
        .boolean()
        .optional()
        .default(false)
        .describe("Apply changes without creating a commit"),
    }),
    requiresConfirmation: true,
    examples: ["cherry-pick commit abc1234", "apply commit to this branch"],
  },
  async ({ commitSha, noCommit }) => {
    const repo = GitService.getRepoContext();
    if (!repo) {
      return {
        success: false,
        message: "No active repo selected",
      };
    }

    const result = await gitCherryPick({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      commit: commitSha,
      no_commit: noCommit,
    });

    if (!result) {
      return {
        success: false,
        message: "Failed to cherry-pick commit",
      };
    }

    return {
      success: result.success,
      message: result.message,
      data: {
        commitSha,
        hasConflicts: result.has_conflicts,
        conflictedFiles: result.conflicted_files,
        errorType: result.error?.error_type ?? null,
      },
    };
  }
);

export const gitRevertCommit = defineZodAction(
  {
    id: ACTION_ID.GIT_REVERT_COMMIT,
    category: "git",
    layer: "action",
    description: "Revert a specific commit",
    params: z.object({
      commitSha: z.string().min(7, "Commit SHA is required"),
      noCommit: z
        .boolean()
        .optional()
        .default(false)
        .describe("Revert changes without creating a commit"),
    }),
    requiresConfirmation: true,
    examples: [
      "revert commit abc1234",
      "undo commit by creating a revert commit",
    ],
  },
  async ({ commitSha, noCommit }) => {
    const repo = GitService.getRepoContext();
    if (!repo) {
      return {
        success: false,
        message: "No active repo selected",
      };
    }

    const result = await gitRevert({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      commit: commitSha,
      no_commit: noCommit,
    });

    if (!result) {
      return {
        success: false,
        message: "Failed to revert commit",
      };
    }

    return {
      success: result.success,
      message: result.message,
      data: {
        commitSha,
        hasConflicts: result.has_conflicts,
        conflictedFiles: result.conflicted_files,
        errorType: result.error?.error_type ?? null,
      },
    };
  }
);

export const gitResetToRef = defineZodAction(
  {
    id: ACTION_ID.GIT_RESET,
    category: "git",
    layer: "action",
    description: "Reset HEAD to a ref with selected mode",
    params: z.object({
      ref: z.string().min(1, "Ref is required"),
      mode: z
        .enum(["soft", "mixed", "hard"])
        .optional()
        .default("mixed")
        .describe("Reset mode"),
    }),
    requiresConfirmation: true,
    examples: ["reset to abc1234 hard", "reset to HEAD~1 mixed"],
  },
  async ({ ref, mode }) => {
    const repo = GitService.getRepoContext();
    if (!repo) {
      return {
        success: false,
        message: "No active repo selected",
      };
    }

    const selectedMode: ResetMode = mode ?? "mixed";
    const result = await gitReset({
      repo_id: repo.repoId,
      repo_path: repo.repoPath,
      ref,
      mode: selectedMode,
    });

    if (!result) {
      return {
        success: false,
        message: "Failed to reset HEAD",
      };
    }

    return {
      success: result.success,
      message: result.message,
      data: {
        ref,
        mode: selectedMode,
        previousHead: result.previous_head,
        newHead: result.new_head,
        errorType: result.error?.error_type ?? null,
      },
    };
  }
);

export const gitResolveConflict = defineZodAction(
  {
    id: ACTION_ID.GIT_RESOLVE_CONFLICT,
    category: "git",
    layer: "action",
    description: "Resolve a merge conflict file using ours or theirs strategy",
    params: z.object({
      path: z.string().min(1, "Path cannot be empty").describe("File path"),
      strategy: z
        .enum(["ours", "theirs"])
        .describe("Resolution strategy: ours (current) or theirs (incoming)"),
    }),
    examples: [
      "accept current change",
      "accept incoming change",
      "resolve conflict with ours",
    ],
  },
  async ({ path, strategy }) => {
    const result = await GitOperationsService.resolveConflict(path, strategy);
    const label = strategy === "ours" ? "current (ours)" : "incoming (theirs)";
    return {
      success: result.success,
      message: result.success
        ? `Resolved ${path} using ${label}`
        : result.message || "Failed to resolve conflict",
      data: { path, strategy, errorType: result.errorType },
    };
  }
);
