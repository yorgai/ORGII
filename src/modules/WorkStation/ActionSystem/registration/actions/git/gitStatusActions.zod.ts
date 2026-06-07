/**
 * Git Status & Diff Actions (Zod-based)
 *
 * Actions for viewing git status and diffs.
 * Includes LLM-friendly formatters for structured data.
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { getGitDiffSummary, getGitStatus } from "@src/api/http/git";
import { GitService } from "@src/services/git";

// ============================================
// Helper: Format status data for LLM
// ============================================

export function formatStatusForLLM(status: {
  current_branch: string;
  working_directory: {
    files: Array<{ path: string; status: string; staged: boolean }>;
    staged_count?: number;
    unstaged_count?: number;
    untracked_count?: number;
  };
  branch_ahead_behind?: { ahead: number; behind: number } | null;
  merge_head_found?: boolean;
  rebase_in_progress?: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`On branch ${status.current_branch}`);

  if (status.branch_ahead_behind) {
    const { ahead, behind } = status.branch_ahead_behind;
    if (ahead > 0 && behind > 0) {
      lines.push(
        `Your branch is ahead by ${ahead} and behind by ${behind} commits`
      );
    } else if (ahead > 0) {
      lines.push(`Your branch is ahead by ${ahead} commit(s)`);
    } else if (behind > 0) {
      lines.push(`Your branch is behind by ${behind} commit(s)`);
    }
  }

  if (status.merge_head_found) lines.push("Merge in progress");
  if (status.rebase_in_progress) lines.push("Rebase in progress");

  const staged = status.working_directory.files.filter((f) => f.staged);
  const unstaged = status.working_directory.files.filter(
    (f) => !f.staged && f.status !== "?"
  );
  const untracked = status.working_directory.files.filter(
    (f) => f.status === "?"
  );

  if (staged.length > 0) {
    lines.push(`\nChanges to be committed (${staged.length}):`);
    for (const file of staged) {
      lines.push(`  ${file.status} ${file.path}`);
    }
  }

  if (unstaged.length > 0) {
    lines.push(`\nChanges not staged for commit (${unstaged.length}):`);
    for (const file of unstaged) {
      lines.push(`  ${file.status} ${file.path}`);
    }
  }

  if (untracked.length > 0) {
    lines.push(`\nUntracked files (${untracked.length}):`);
    for (const file of untracked) {
      lines.push(`  ${file.path}`);
    }
  }

  if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
    lines.push("Nothing to commit, working tree clean");
  }

  return lines.join("\n");
}

export function formatDiffSummaryForLLM(summary: {
  total_files: number;
  total_additions: number;
  total_deletions: number;
  files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
}): string {
  const lines: string[] = [];
  lines.push(
    `${summary.total_files} file(s) changed, ${summary.total_additions} insertion(s), ${summary.total_deletions} deletion(s)`
  );
  for (const file of summary.files) {
    lines.push(
      `  ${file.status.charAt(0).toUpperCase()} ${file.path} (+${file.additions} -${file.deletions})`
    );
  }
  return lines.join("\n");
}

// ============================================
// Status & Diff Actions
// ============================================

export const gitStatus = defineZodAction(
  {
    id: ACTION_ID.GIT_STATUS,
    category: "git",
    layer: "action",
    description: "Show git status",
    params: z.object({}),
    examples: ["git status", "show changes", "what changed"],
  },
  async () => {
    try {
      await GitService.status();

      const repo = GitService.getRepoContext();
      if (repo) {
        const statusData = await getGitStatus({
          repo_id: repo.repoId,
          repo_path: repo.repoPath,
        });
        if (statusData) {
          return {
            success: true,
            message: "Showing git status",
            data: {
              text: formatStatusForLLM(statusData),
              structured: statusData,
            },
          };
        }
      }

      return { success: true, message: "Showing git status" };
    } catch (error) {
      return {
        success: false,
        message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
);

export const gitDiff = defineZodAction(
  {
    id: ACTION_ID.GIT_DIFF,
    category: "git",
    layer: "action",
    description: "Show diff",
    params: z.object({
      path: z.string().optional().describe("File path (defaults to all)"),
    }),
    examples: ["show diff", "git diff"],
  },
  async ({ path }) => {
    try {
      await GitService.diff(path);

      const repo = GitService.getRepoContext();
      if (repo) {
        const diffSummary = await getGitDiffSummary({
          repo_id: repo.repoId,
        });
        if (diffSummary) {
          return {
            success: true,
            message: "Showing diff",
            data: {
              text: formatDiffSummaryForLLM(diffSummary),
              structured: diffSummary,
            },
          };
        }
      }

      return { success: true, message: "Showing diff" };
    } catch (error) {
      return {
        success: false,
        message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
);
