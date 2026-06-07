/**
 * Shared pull error handling logic for useSyncOperations.
 * Both handleSync and handlePull share the same dialog flow for pull errors.
 */
import type { TypedDispatch } from "@src/ActionSystem";
import {
  PullConflictDialog,
  RebaseConflictDialog,
} from "@src/components/GitDialogs";
import type { GitOperationResult } from "@src/hooks/git/useGitOperations";
import type { GitFile } from "@src/types/git/types";

export interface HandlePullErrorOptions {
  pullResult: GitOperationResult;
  currentBranch: string | undefined;
  currentFiles: GitFile[];
  doPull: () => Promise<GitOperationResult>;
  stashPush: (message?: string, includeUntracked?: boolean) => Promise<boolean>;
  dispatch: TypedDispatch | undefined;
}

/**
 * Handles error cases from a failed git pull by showing the appropriate dialog.
 * Returns `true` if the error was handled (caller should return early).
 * Returns `false` if the error was not recognized (caller should log and return).
 */
export async function handlePullError({
  pullResult,
  currentBranch,
  currentFiles,
  doPull,
  stashPush,
  dispatch,
}: HandlePullErrorOptions): Promise<boolean> {
  if (pullResult.errorType === "uncommitted_changes") {
    const result = await PullConflictDialog.open({
      branchName: currentBranch || "current branch",
      remoteName: "origin",
      conflictingFiles: currentFiles
        .filter((file: GitFile) => !file.staged)
        .map((file: GitFile) => file.path)
        .slice(0, 10),
    });

    if (result === "stash_pull") {
      await stashPush();
      const retryPull = await doPull();
      if (!retryPull.success) {
        console.error("Pull failed after stash");
      }
    } else if (result === "discard_pull") {
      const allFilePaths = currentFiles.map((file: GitFile) => file.path);
      if (allFilePaths.length > 0 && dispatch) {
        await dispatch("git.discardAll", {}, "user");
      }
      const retryPull = await doPull();
      if (!retryPull.success) {
        console.error("Pull failed after discard");
      }
    }
    return true;
  }

  if (pullResult.errorType === "merge_conflicts") {
    const result = await RebaseConflictDialog.open({
      conflictingFiles: currentFiles
        .filter((fileItem: GitFile) => fileItem.status === "conflict")
        .map((fileItem: GitFile) => fileItem.path),
      operationType: "merge",
    });

    if (result === "abort" && dispatch) {
      await dispatch("git.mergeAbort", {}, "user");
    }
    return true;
  }

  return false;
}
