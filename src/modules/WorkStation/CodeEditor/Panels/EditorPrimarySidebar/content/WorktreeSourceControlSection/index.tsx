/**
 * WorktreeSourceControlSection
 *
 * Shared component that renders a full SourceControlContent for a single git
 * worktree via usePerRepoSourceControl.  Used by both:
 *   - SourceControlTab   (single-repo + worktrees layout)
 *   - MultiRootSourceControlContent  (multi-root layout)
 */
import React, { useCallback, useEffect, useMemo } from "react";

import type { GitFile } from "@src/types/git/types";

import {
  type UsePerRepoSourceControlResult,
  usePerRepoSourceControl,
} from "../../hooks/usePerRepoSourceControl";
import SourceControlContent from "../SourceControlContent";

export interface WorktreeSourceControlSectionProps {
  worktreePath: string;
  worktreeId: string;
  onGitFileSelect?: (file: GitFile) => void;
  /**
   * Continuously sync this worktree's file list (with absolute paths and
   * `repoRoot`) up to the parent so consumers like GitAllChangesContent can
   * render worktree diffs without requiring a per-file click first.
   */
  onGitFilesChange?: (files: GitFile[], worktreePath: string) => void;
  showFilter: boolean;
  viewMode: "list-tree" | "list";
  navigateWithoutSelecting?: boolean;
  /** Working-tree section filter forwarded to SourceControlContent. */
  sectionFilter?: "uncommitted" | "staged" | "unstaged";
}

const toAbsoluteWorktreeFile = (
  file: GitFile,
  worktreePath: string
): GitFile => {
  const absolutePath = file.path.startsWith("/")
    ? file.path
    : `${worktreePath}/${file.path}`;
  return { ...file, path: absolutePath, repoRoot: worktreePath };
};

export const WorktreeSourceControlSection: React.FC<
  WorktreeSourceControlSectionProps
> = ({
  worktreePath,
  worktreeId,
  onGitFileSelect,
  onGitFilesChange,
  showFilter,
  viewMode,
  navigateWithoutSelecting,
  sectionFilter,
}) => {
  // Paths inside a worktree are relative. The upstream onGitFileSelect handler
  // (handleGitFileSelect in useCodeEditorHandlers) builds the absolute path by
  // prepending the host's repoPath — which is the *main* repo, not this
  // worktree. Pre-resolve relative paths to absolute worktree paths here so
  // the handler fetches the diff from the correct directory.
  const handleGitFileSelect = useCallback(
    (file: GitFile) => {
      if (!onGitFileSelect) return;
      onGitFileSelect(toAbsoluteWorktreeFile(file, worktreePath));
    },
    [onGitFileSelect, worktreePath]
  );

  const { state, refresh, loading }: UsePerRepoSourceControlResult =
    usePerRepoSourceControl({
      repoPath: worktreePath,
      repoId: worktreeId,
      onGitFileSelect: handleGitFileSelect,
    });

  const absoluteFiles = useMemo(
    () => state.files.map((file) => toAbsoluteWorktreeFile(file, worktreePath)),
    [state.files, worktreePath]
  );

  useEffect(() => {
    onGitFilesChange?.(absoluteFiles, worktreePath);
  }, [onGitFilesChange, absoluteFiles, worktreePath]);

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const files = state.files;
  const selectFile = state.onFileSelect;

  const handleContentFileSelect = useCallback(
    (fileId: string) => {
      if (!navigateWithoutSelecting) {
        selectFile(fileId);
        return;
      }
      const file = files.find((candidate) => candidate.id === fileId);
      if (file) {
        handleGitFileSelect(file);
      }
    },
    [files, handleGitFileSelect, navigateWithoutSelecting, selectFile]
  );

  return (
    <SourceControlContent
      files={state.files}
      filteredFiles={state.filteredFiles}
      selectedFileId={navigateWithoutSelecting ? "" : state.selectedFileId}
      loading={loading}
      error={state.error}
      onFileSelect={handleContentFileSelect}
      onStageToggle={state.onStageToggle}
      onDiscard={state.onDiscard}
      onDiscardFiles={state.onDiscardFiles}
      onStageAll={state.onStageAll}
      onUnstageAll={state.onUnstageAll}
      onDiscardAll={state.onDiscardAll}
      commitMessage={state.commitMessage}
      onCommitMessageChange={state.onCommitMessageChange}
      onCommit={state.onCommit}
      commitLoading={state.commitLoading}
      generateCommitMessageLoading={state.generateCommitMessageLoading}
      onGenerateCommitMessage={state.onGenerateCommitMessage}
      stagedFilesCount={state.stagedFilesCount}
      branchName={state.branchName}
      searchQuery={state.searchQuery}
      onSearchChange={state.onSearchChange}
      showFilter={showFilter}
      viewMode={viewMode}
      sectionFilter={sectionFilter}
      navigateWithoutSelecting={navigateWithoutSelecting}
      onRefresh={handleRefresh}
      ahead={state.ahead}
      behind={state.behind}
      hasUpstream={state.hasUpstream}
      repoId={worktreeId}
      repoPath={worktreePath}
    />
  );
};

WorktreeSourceControlSection.displayName = "WorktreeSourceControlSection";

export default WorktreeSourceControlSection;
