/**
 * useMergeRebaseState Hook
 *
 * Handles merge and rebase state detection, conflict management,
 * and related dialogs.
 *
 * Uses dispatch() for all git operations to ensure AI/human unification.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useActionSystemOptional } from "@src/ActionSystem";
import { RebaseConflictDialog } from "@src/components/GitDialogs";
import type { GitFile } from "@src/types/git/types";
import type { GitRepositoryStatus } from "@src/types/session/steps";

export interface UseMergeRebaseStateOptions {
  gitStatus: GitRepositoryStatus | null;
  gitFiles: GitFile[];
  selectedRepoId: string | null;
  repoPath: string;
  currentBranch: string | undefined;
  fetchGitStatus: () => Promise<void>;
  handleCommit: () => Promise<void>;
}

export interface UseMergeRebaseStateResult {
  /** Files with merge conflicts */
  conflictFiles: GitFile[];
  /** Whether there are any unresolved merge conflicts */
  hasConflicts: boolean;
  /** Whether currently in a merge operation */
  isMerging: boolean;
  /** Whether currently in a rebase operation */
  isRebasing: boolean;
  /** Merge source branch name */
  mergingBranch: string | undefined;
  /** Continue merge after resolving conflicts */
  handleContinueMerge: () => void;
}

export function useMergeRebaseState(
  options: UseMergeRebaseStateOptions
): UseMergeRebaseStateResult {
  const {
    gitStatus,
    gitFiles,
    selectedRepoId: _selectedRepoId,
    repoPath: _repoPath,
    currentBranch,
    fetchGitStatus,
    handleCommit,
  } = options;

  // Get dispatch for unified operations
  const actionSystem = useActionSystemOptional();
  const dispatch = actionSystem?.dispatch;

  // Filter conflict files (VS Code "Merge Changes" section)
  const conflictFiles = useMemo(
    () => gitFiles.filter((file) => (file.status as string) === "conflict"),
    [gitFiles]
  );

  // Use API flag if available, otherwise check local conflict files
  const hasConflicts = useMemo(() => {
    if (gitStatus?.do_conflicted_files_exist !== undefined) {
      return gitStatus.do_conflicted_files_exist;
    }
    return conflictFiles.length > 0;
  }, [gitStatus, conflictFiles.length]);

  // Detect if we're in a merge operation
  const isMerging = useMemo(() => {
    if (gitStatus?.merge_head_found) {
      return true;
    }
    return hasConflicts;
  }, [gitStatus?.merge_head_found, hasConflicts]);

  // Detect if we're in a rebase operation
  const isRebasing = useMemo(() => {
    return gitStatus?.rebase_in_progress ?? false;
  }, [gitStatus?.rebase_in_progress]);

  // Get the merge source branch name
  const mergingBranch = useMemo(() => {
    // Future enhancement: Parse .git/MERGE_MSG for the branch name
    return undefined;
  }, []);

  // Handle rebase conflict dialog
  const handleRebaseConflictDialog = useCallback(async () => {
    if (!isRebasing || !hasConflicts) return;

    const result = await RebaseConflictDialog.open({
      targetBranch: currentBranch || "target branch",
      conflictingFiles: gitFiles
        .filter((file) => file.status === "conflict")
        .map((file) => file.path)
        .slice(0, 10),
    });

    if (result === "abort") {
      try {
        // Use dispatch for rebase abort
        if (dispatch) {
          await dispatch("git.rebaseAbort", {}, "user");
        }
        await fetchGitStatus();
      } catch (error) {
        console.error("Failed to abort rebase:", error);
      }
    }
  }, [
    isRebasing,
    hasConflicts,
    currentBranch,
    gitFiles,
    dispatch,
    fetchGitStatus,
  ]);

  // Show rebase conflict dialog when rebase is in progress with conflicts
  const hasShownRebaseDialogRef = useRef(false);
  useEffect(() => {
    if (isRebasing && hasConflicts && !hasShownRebaseDialogRef.current) {
      hasShownRebaseDialogRef.current = true;
      handleRebaseConflictDialog();
    } else if (!isRebasing) {
      hasShownRebaseDialogRef.current = false;
    }
  }, [isRebasing, hasConflicts, handleRebaseConflictDialog]);

  // Handle continue merge (commit the merge after conflicts are resolved)
  const handleContinueMerge = useCallback(() => {
    handleCommit();
  }, [handleCommit]);

  return {
    conflictFiles,
    hasConflicts,
    isMerging,
    isRebasing,
    mergingBranch,
    handleContinueMerge,
  };
}
