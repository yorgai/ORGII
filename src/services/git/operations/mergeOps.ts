/**
 * Merge Operations — mergeAbort, rebaseAbort
 */
import { gitApi } from "@src/api/http/git";

import { TerminalService } from "../../terminal";
import {
  type GitOperationResult,
  getRepoContext,
  parseGitError,
} from "./types";

// ============================================
// Core Operations
// ============================================

/**
 * Abort a merge operation
 */
export async function mergeAbort(): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitMergeAbort({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
      });
      return { success: true, errorType: "none" };
    } catch (error) {
      const parsed = parseGitError(error);
      return {
        success: false,
        errorType: parsed.type,
        message: parsed.message,
      };
    }
  }

  try {
    await TerminalService.execute("git merge --abort");
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}

/**
 * Abort a rebase operation
 */
export async function rebaseAbort(): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitRebaseAbort({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
      });
      return { success: true, errorType: "none" };
    } catch (error) {
      const parsed = parseGitError(error);
      return {
        success: false,
        errorType: parsed.type,
        message: parsed.message,
      };
    }
  }

  try {
    await TerminalService.execute("git rebase --abort");
    return { success: true, errorType: "none" };
  } catch (error) {
    const parsed = parseGitError(error);
    return {
      success: false,
      errorType: parsed.type,
      message: parsed.message,
    };
  }
}
