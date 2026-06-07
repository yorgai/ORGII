/**
 * Git Stash Actions (Zod-based)
 *
 * Actions for stash, stash pop, stash apply, and stash drop.
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { GitOperationsService } from "@src/services/git";

export const gitStash = defineZodAction(
  {
    id: ACTION_ID.GIT_STASH,
    category: "git",
    layer: "action",
    description: "Stash current changes",
    params: z.object({
      message: z.string().optional().describe("Stash message"),
      includeUntracked: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include untracked files"),
    }),
    examples: ["stash changes", "git stash"],
  },
  async ({ message, includeUntracked }) => {
    const result = await GitOperationsService.stash(message, includeUntracked);
    return {
      success: result.success,
      message: result.success
        ? "Changes stashed"
        : result.message || "Failed to stash",
      data: {
        stashMessage: message,
        includeUntracked,
        errorType: result.errorType,
      },
    };
  }
);

export const gitStashPop = defineZodAction(
  {
    id: ACTION_ID.GIT_STASH_POP,
    category: "git",
    layer: "action",
    description: "Pop a stash by index (apply and remove)",
    params: z.object({
      index: z.number().int().min(0).default(0),
    }),
    examples: ["pop stash", "git stash pop"],
  },
  async ({ index }) => {
    const result = await GitOperationsService.stashPop(index);
    return {
      success: result.success,
      message: result.success
        ? "Stash popped"
        : result.message || "Failed to pop stash",
      data: { errorType: result.errorType },
    };
  }
);

export const gitStashApply = defineZodAction(
  {
    id: ACTION_ID.GIT_STASH_APPLY,
    category: "git",
    layer: "action",
    description: "Apply a stash without removing it",
    params: z.object({
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Stash index (defaults to 0)"),
    }),
    examples: ["apply stash", "apply stash 1"],
  },
  async ({ index }) => {
    const stashIndex = index ?? 0;
    const result = await GitOperationsService.stashApply(stashIndex);
    return {
      success: result.success,
      message: result.success
        ? `Applied stash@{${stashIndex}}`
        : result.message || "Failed to apply stash",
      data: { index: stashIndex, errorType: result.errorType },
    };
  }
);

export const gitStashDrop = defineZodAction(
  {
    id: ACTION_ID.GIT_STASH_DROP,
    category: "git",
    layer: "action",
    description: "Drop a stash",
    params: z.object({
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Stash index (defaults to 0)"),
    }),
    requiresConfirmation: true,
    examples: ["drop stash", "drop stash 1"],
  },
  async ({ index }) => {
    const stashIndex = index ?? 0;
    const result = await GitOperationsService.stashDrop(stashIndex);
    return {
      success: result.success,
      message: result.success
        ? `Dropped stash@{${stashIndex}}`
        : result.message || "Failed to drop stash",
      data: { index: stashIndex, errorType: result.errorType },
    };
  }
);
