/**
 * Branch Operations — checkout, stash, stashPop, stashApply, stashDrop
 */
import { gitApi } from "@src/api/http/git";
import { showGitErrorAndHandle } from "@src/hooks/git/useGitErrorDialog";

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
 * Checkout a branch
 */
export async function checkout(
  branch: string,
  create?: boolean
): Promise<GitOperationResult> {
  const cmd = create ? `git checkout -b ${branch}` : `git checkout ${branch}`;
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitCheckout({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        ref: branch,
        create,
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
    await TerminalService.execute(cmd);
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
 * Stash changes
 */
export async function stash(
  message?: string,
  includeUntracked?: boolean
): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitStashPush({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        message: message || null,
        include_untracked: includeUntracked || false,
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

  let cmd = "git stash push";
  if (includeUntracked) {
    cmd += " --include-untracked";
  }
  if (message) {
    cmd += ` -m "${message}"`;
  }
  try {
    await TerminalService.execute(cmd);
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
 * Pop a stash by index (apply and remove)
 */
export async function stashPop(index: number = 0): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitStashApply({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        index,
        pop: true,
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
    await TerminalService.execute(`git stash pop stash@{${index}}`);
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
 * Apply stash without removing
 */
export async function stashApply(
  index: number = 0
): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitStashApply({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        index,
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
    await TerminalService.execute(`git stash apply stash@{${index}}`);
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
 * Drop a stash
 */
export async function stashDrop(
  index: number = 0
): Promise<GitOperationResult> {
  const repo = getRepoContext();

  if (repo) {
    try {
      await gitApi.gitStashDrop({
        repo_id: repo.repoId,
        repo_path: repo.repoPath,
        index,
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
    await TerminalService.execute(`git stash drop stash@{${index}}`);
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

// ============================================
// Operations with Error Dialog
// ============================================

/**
 * Checkout with error dialog on failure.
 *
 * TODO(#17 de-dup): this is a second checkout path with its own error dialog,
 * separate from the canonical `useBranchCheckout.selectBranch` flow that drives
 * the CheckoutConflictDialog (stash/discard/cancel). For now we only ensure the
 * shared classifier (`gitErrorDialog.inferErrorTypeFromText`) detects
 * `uncommitted_changes` for the `checkout` operation. A full reroute onto
 * `selectBranch` must preserve this function's `{ success, message, errorType }`
 * result contract for ActionSystem callers before it can be done safely.
 */
export async function checkoutWithDialog(
  branch: string,
  create?: boolean
): Promise<GitOperationResult> {
  const repoContext = getRepoContext();
  const result = await checkout(branch, create);

  if (!result.success && result.errorType !== "none") {
    await showGitErrorAndHandle({
      operation: "checkout",
      repoId: repoContext?.repoId,
      repoPath: repoContext?.repoPath,
      errorType: result.errorType,
      errorMessage: result.message || "Checkout failed",
    });
  }
  return result;
}
