/**
 * Git Remote Actions (Zod-based)
 *
 * Actions for push, pull, fetch, sync, and publish operations.
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { GitOperationsService } from "@src/services/git";

// ============================================
// Push, Pull, Fetch Actions
// ============================================

export const gitPush = defineZodAction(
  {
    id: ACTION_ID.GIT_PUSH,
    category: "git",
    layer: "action",
    description: "Push commits to remote",
    params: z.object({
      force: z
        .boolean()
        .optional()
        .default(false)
        .describe("Force push (dangerous)"),
    }),
    requiresConfirmation: true,
    examples: ["push", "git push"],
  },
  async ({ force }) => {
    const result = await GitOperationsService.pushWithDialog({ force });
    return {
      success: result.success,
      message: result.success
        ? "Pushed to remote"
        : result.message || "Failed to push",
      data: {
        force,
        errorType: result.errorType,
        errorMessage: result.message,
      },
    };
  }
);

export const gitPull = defineZodAction(
  {
    id: ACTION_ID.GIT_PULL,
    category: "git",
    layer: "action",
    description: "Pull from remote",
    params: z.object({}),
    examples: ["pull", "git pull"],
  },
  async () => {
    const result = await GitOperationsService.pullWithDialog();
    return {
      success: result.success,
      message: result.success
        ? "Pulled from remote"
        : result.message || "Failed to pull",
      data: { errorType: result.errorType, errorMessage: result.message },
    };
  }
);

export const gitFetch = defineZodAction(
  {
    id: ACTION_ID.GIT_FETCH,
    category: "git",
    layer: "action",
    description: "Fetch from remote",
    params: z.object({}),
    examples: ["fetch", "git fetch"],
  },
  async () => {
    const result = await GitOperationsService.fetchWithDialog();
    return {
      success: result.success,
      message: result.success
        ? "Fetched from remote"
        : result.message || "Failed to fetch",
      data: { errorType: result.errorType, errorMessage: result.message },
    };
  }
);

// ============================================
// Sync & Publish Actions
// ============================================

export const gitSync = defineZodAction(
  {
    id: ACTION_ID.GIT_SYNC,
    category: "git",
    layer: "action",
    description: "Sync with remote (pull then push)",
    params: z.object({}),
    examples: ["sync", "git sync", "pull and push"],
  },
  async () => {
    const result = await GitOperationsService.syncWithDialog();
    return {
      success: result.success,
      message: result.success
        ? "Synced with remote"
        : result.message || "Sync failed",
      data: { errorType: result.errorType, errorMessage: result.message },
    };
  }
);

export const gitPublish = defineZodAction(
  {
    id: ACTION_ID.GIT_PUBLISH,
    category: "git",
    layer: "action",
    description: "Publish branch to remote (push with --set-upstream)",
    params: z.object({}),
    examples: ["publish branch", "push new branch"],
  },
  async () => {
    const result = await GitOperationsService.publish();
    return {
      success: result.success,
      message: result.success
        ? "Branch published"
        : result.message || "Failed to publish branch",
      data: { errorType: result.errorType, errorMessage: result.message },
    };
  }
);
