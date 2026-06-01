/**
 * Hook for commit button logic and state
 *
 * Handles:
 * - Smart commit logic (commit all if no staged files)
 * - Commit button text based on state
 * - Merge state handling
 * - Sync/Publish button visibility
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  GIT_LABELS,
  formatCommitAndPublishFileCount,
  formatCommitFileCount,
} from "../config";

export interface UseCommitLogicOptions {
  stagedFilesCount: number;
  unstagedFilesCount: number;
  commitMessage: string;
  isMerging: boolean;
  hasConflicts: boolean;
  conflictFilesCount: number;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  onSync?: () => void;
  onPublish?: () => Promise<void>;
}

export interface UseCommitLogicResult {
  hasUnstagedFiles: boolean;
  hasStagedFiles: boolean;
  hasChanges: boolean;
  hasMessage: boolean;
  hasUnresolvedConflicts: boolean;
  canCommit: boolean;
  commitButtonText: string;
  showPublishButton: boolean;
  showCommitAndPublishButton: boolean;
  commitAndPublishButtonText: string;
  showSyncButton: boolean;
}

export function useCommitLogic(
  options: UseCommitLogicOptions
): UseCommitLogicResult {
  const {
    stagedFilesCount,
    unstagedFilesCount,
    commitMessage,
    isMerging,
    hasConflicts,
    conflictFilesCount,
    hasUpstream,
    ahead,
    behind,
    onSync,
    onPublish,
  } = options;

  const { t } = useTranslation();

  return useMemo(() => {
    const hasUnstagedFiles = unstagedFilesCount > 0;
    const hasStagedFiles = stagedFilesCount > 0;
    const hasChanges = hasStagedFiles || hasUnstagedFiles;
    const hasMessage = commitMessage.trim().length > 0;
    const hasUnresolvedConflicts = hasConflicts && conflictFilesCount > 0;

    // Can commit/continue:
    // - During merge: can continue if no unresolved conflicts and has changes
    // - Normal: need changes and message
    const canCommit = isMerging
      ? !hasUnresolvedConflicts && hasChanges
      : hasChanges && hasMessage;

    const commitButtonText = isMerging
      ? t("git.commitButtons.continueMerge")
      : hasStagedFiles
        ? formatCommitFileCount("staged", stagedFilesCount)
        : hasUnstagedFiles
          ? formatCommitFileCount("all", unstagedFilesCount)
          : GIT_LABELS.commit;

    const commitAndPublishButtonText = hasStagedFiles
      ? formatCommitAndPublishFileCount("staged", stagedFilesCount)
      : hasUnstagedFiles
        ? formatCommitAndPublishFileCount("all", unstagedFilesCount)
        : GIT_LABELS.commitAndPublish;

    const isPublishFlow = hasUpstream === false && !!onPublish && !isMerging;
    const showCommitAndPublishButton = isPublishFlow && hasChanges;
    const showPublishButton =
      isPublishFlow && !hasChanges && !commitMessage.trim();

    // Show Sync Changes button when: no files to commit, no commit message, but have commits to sync
    const showSyncButton =
      !hasChanges &&
      !commitMessage.trim() &&
      hasUpstream !== false &&
      (ahead > 0 || behind > 0) &&
      !!onSync &&
      !isMerging;

    return {
      hasUnstagedFiles,
      hasStagedFiles,
      hasChanges,
      hasMessage,
      hasUnresolvedConflicts,
      canCommit,
      commitButtonText,
      showPublishButton,
      showCommitAndPublishButton,
      commitAndPublishButtonText,
      showSyncButton,
    };
  }, [
    t,
    stagedFilesCount,
    unstagedFilesCount,
    commitMessage,
    isMerging,
    hasConflicts,
    conflictFilesCount,
    hasUpstream,
    ahead,
    behind,
    onSync,
    onPublish,
  ]);
}
