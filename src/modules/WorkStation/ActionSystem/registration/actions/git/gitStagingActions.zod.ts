/**
 * Git Staging & Commit Actions (Zod-based)
 *
 * Actions for staging, unstaging, committing, and discarding changes.
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { GitOperationsService } from "@src/services/git";

// ============================================
// Stage & Unstage Actions
// ============================================

export const gitStage = defineZodAction(
  {
    id: ACTION_ID.GIT_STAGE,
    category: "git",
    layer: "action",
    description: "Stage files for commit",
    params: z.object({
      paths: z
        .array(z.string())
        .optional()
        .describe("File paths to stage (defaults to all)"),
    }),
    examples: ["stage all", "git add", "stage changes"],
  },
  async ({ paths }) => {
    const result = await GitOperationsService.stageWithDialog(paths);
    return {
      success: result.success,
      message: result.success
        ? "Files staged"
        : result.message || "Failed to stage files",
      data: { paths: paths || ["."], errorType: result.errorType },
    };
  }
);

export const gitUnstage = defineZodAction(
  {
    id: ACTION_ID.GIT_UNSTAGE,
    category: "git",
    layer: "action",
    description: "Unstage files",
    params: z.object({
      paths: z
        .array(z.string())
        .optional()
        .describe("File paths to unstage (defaults to all)"),
    }),
    examples: ["unstage all", "git reset"],
  },
  async ({ paths }) => {
    const result = await GitOperationsService.unstageWithDialog(paths);
    return {
      success: result.success,
      message: result.success
        ? "Files unstaged"
        : result.message || "Failed to unstage files",
      data: { paths: paths || ["."], errorType: result.errorType },
    };
  }
);

// ============================================
// Commit Actions
// ============================================

export const gitCommit = defineZodAction(
  {
    id: ACTION_ID.GIT_COMMIT,
    category: "git",
    layer: "action",
    description: "Commit staged changes",
    params: z.object({
      message: z
        .string()
        .min(1, "Commit message cannot be empty")
        .describe("Commit message"),
    }),
    requiresConfirmation: true,
    examples: ["commit with message", "git commit"],
  },
  async ({ message }) => {
    const result = await GitOperationsService.commitWithDialog(message);
    return {
      success: result.success,
      message: result.success
        ? `Committed: ${message}`
        : result.message || "Failed to commit",
      data: {
        commitMessage: message,
        errorType: result.errorType,
        errorMessage: result.message,
      },
    };
  }
);

// ============================================
// Discard Actions
// ============================================

export const gitDiscard = defineZodAction(
  {
    id: ACTION_ID.GIT_DISCARD,
    category: "git",
    layer: "action",
    description: "Discard changes to a file",
    params: z.object({
      path: z.string().min(1, "Path cannot be empty").describe("File path"),
    }),
    requiresConfirmation: true,
    examples: ["discard changes", "revert file"],
  },
  async ({ path }) => {
    const result = await GitOperationsService.discard([path]);
    return {
      success: result.success,
      message: result.success
        ? `Discarded: ${path}`
        : result.message || "Failed to discard",
      data: { path, errorType: result.errorType },
    };
  }
);

export const gitDiscardAll = defineZodAction(
  {
    id: ACTION_ID.GIT_DISCARD_ALL,
    category: "git",
    layer: "action",
    description: "Discard all unstaged changes",
    params: z.object({}),
    requiresConfirmation: true,
    examples: ["discard all changes", "reset all"],
  },
  async () => {
    const result = await GitOperationsService.discardAll();
    return {
      success: result.success,
      message: result.success
        ? "All changes discarded"
        : result.message || "Failed to discard all",
      data: { errorType: result.errorType },
    };
  }
);
