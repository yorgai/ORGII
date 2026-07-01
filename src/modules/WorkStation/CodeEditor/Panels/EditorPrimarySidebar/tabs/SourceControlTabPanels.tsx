/**
 * SourceControlTabPanels
 *
 * Internal panel components for the Source Control tab:
 * - SourceControlTabContent: wraps SourceControlContent with useSourceControlState
 * - MainRepoSectionContent: main repository content for multi-worktree layout
 * - SourceControlWithWorktrees: scoped host/worktree source control pane
 *
 * Extracted from SourceControlTab.tsx to keep it under 600 lines.
 * PERFORMANCE (Jan 2026): useSourceControlState only runs on first mount.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import type { GitWorktreeEntry } from "@src/api/http/git/types";
import { repoApi } from "@src/api/tauri/repo";
import Message from "@src/components/Message";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import type { GitFile } from "@src/types/git/types";

import SourceControlContent from "../content/SourceControlContent";
import { WorktreeSourceControlSection } from "../content/WorktreeSourceControlSection";
import { useSourceControlState } from "../hooks/useSourceControlState";
import type { SourceControlScope } from "./sourceControlScopePickerHelpers";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SourceControlContentHandle {
  refresh: () => Promise<void>;
}

interface SourceControlContentProps {
  repoPath: string;
  repoId: string;
  onGitFileSelect?: (file: GitFile) => void;
  /**
   * Notified when this pane's file list changes. The optional
   * `scopeRepoRoot` identifies which repo reported the update — the
   * consumer can use it to scope a bulk replace and avoid wiping entries
   * contributed by sibling panes (e.g. worktrees alongside the host repo).
   */
  onGitFilesChange?: (files: GitFile[], scopeRepoRoot?: string) => void;
  onGitHistorySelectionChange?: (
    selection: SourceControlHistorySelection
  ) => void;
  showFilter: boolean;
  viewMode: "list-tree" | "list";
  showOnlyStashes?: boolean;
  navigateWithoutSelecting?: boolean;
  /** Working-tree section filter: "uncommitted" | "staged" | "unstaged". */
  sectionFilter?: "uncommitted" | "staged" | "unstaged";
}

export function NotGitInitializedContent({
  repoPath,
  onInitialized,
}: {
  repoPath: string;
  onInitialized: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [initializing, setInitializing] = useState(false);

  const handleInitializeGit = useCallback(async () => {
    setInitializing(true);
    try {
      await repoApi.importLocalRepo({ fs_path: repoPath });
      await onInitialized();
    } catch (error) {
      Message.error(
        error instanceof Error ? error.message : t("errors.unexpectedError")
      );
    } finally {
      setInitializing(false);
    }
  }, [onInitialized, repoPath, t]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Placeholder
        variant={initializing ? "loading" : "empty"}
        placement="sidebar"
        title={
          initializing
            ? t("sourceControl.initializingGit")
            : t("sourceControl.notGitInitialized")
        }
        subtitle={
          initializing
            ? undefined
            : t("sourceControl.notGitInitializedSubtitle")
        }
        action={
          initializing
            ? undefined
            : {
                label: t("sourceControl.initializeGit"),
                onClick: handleInitializeGit,
                variant: "primary",
              }
        }
        fillParentHeight
      />
    </div>
  );
}

// ── SourceControlTabContent ───────────────────────────────────────────────────

export const SourceControlTabContent = forwardRef<
  SourceControlContentHandle,
  SourceControlContentProps
>(
  (
    {
      repoPath,
      repoId,
      onGitFileSelect,
      onGitFilesChange,
      onGitHistorySelectionChange,
      showFilter,
      viewMode,
      showOnlyStashes,
      navigateWithoutSelecting,
      sectionFilter,
    },
    ref
  ) => {
    const sourceControlState = useSourceControlState({
      repoPath,
      repoId,
      onGitFileSelect,
    });

    useEffect(() => {
      onGitFilesChange?.(sourceControlState.state.files, repoPath);
    }, [onGitFilesChange, sourceControlState.state.files, repoPath]);

    const refresh = useCallback(async () => {
      await sourceControlState.refresh();
    }, [sourceControlState]);

    const sourceControlFiles = sourceControlState.state.files;
    const selectSourceControlFile = sourceControlState.state.onFileSelect;

    const handleContentFileSelect = useCallback(
      (fileId: string) => {
        if (!navigateWithoutSelecting) {
          selectSourceControlFile(fileId);
          return;
        }
        const file = sourceControlFiles.find(
          (candidate) => candidate.id === fileId
        );
        if (file) {
          onGitFileSelect?.(file);
        }
      },
      [
        navigateWithoutSelecting,
        onGitFileSelect,
        selectSourceControlFile,
        sourceControlFiles,
      ]
    );

    useImperativeHandle(ref, () => ({ refresh }), [refresh]);

    return (
      <SourceControlContent
        repoId={repoId}
        repoPath={repoPath}
        files={sourceControlState.state.files}
        filteredFiles={sourceControlState.state.filteredFiles}
        selectedFileId={
          navigateWithoutSelecting
            ? ""
            : sourceControlState.state.selectedFileId
        }
        loading={sourceControlState.loading}
        error={sourceControlState.state.error}
        onFileSelect={handleContentFileSelect}
        onStageToggle={sourceControlState.state.onStageToggle}
        onDiscard={sourceControlState.state.onDiscard}
        onDiscardFiles={sourceControlState.state.onDiscardFiles}
        onStageAll={sourceControlState.state.onStageAll}
        onUnstageAll={sourceControlState.state.onUnstageAll}
        onDiscardAll={sourceControlState.state.onDiscardAll}
        onOpenChanges={sourceControlState.state.onOpenChanges}
        onOpenStagedChanges={sourceControlState.state.onOpenStagedChanges}
        commitMessage={sourceControlState.state.commitMessage}
        onCommitMessageChange={sourceControlState.state.onCommitMessageChange}
        onCommit={sourceControlState.state.onCommit}
        onCommitAndPush={sourceControlState.state.onCommitAndPush}
        onCommitAndPublish={sourceControlState.state.onCommitAndPublish}
        onCommitAndSync={sourceControlState.state.onCommitAndSync}
        onAmend={sourceControlState.state.onAmend}
        commitLoading={sourceControlState.state.commitLoading}
        generateCommitMessageLoading={
          sourceControlState.state.generateCommitMessageLoading
        }
        onGenerateCommitMessage={
          sourceControlState.state.onGenerateCommitMessage
        }
        stagedFilesCount={sourceControlState.state.stagedFilesCount}
        branchName={sourceControlState.state.branchName}
        searchQuery={sourceControlState.state.searchQuery}
        onSearchChange={sourceControlState.state.onSearchChange}
        showFilter={showFilter}
        viewMode={viewMode}
        showOnlyStashes={showOnlyStashes}
        sectionFilter={sectionFilter}
        navigateWithoutSelecting={navigateWithoutSelecting}
        conflictFiles={sourceControlState.state.conflictFiles}
        hasConflicts={sourceControlState.state.hasConflicts}
        onStageResolved={sourceControlState.state.onStageResolved}
        isMerging={sourceControlState.state.isMerging}
        mergingBranch={sourceControlState.state.mergingBranch}
        onContinueMerge={sourceControlState.state.onContinueMerge}
        stashes={sourceControlState.state.stashes}
        stashOperationLoading={sourceControlState.state.stashOperationLoading}
        hasChangesToStash={sourceControlState.state.hasChangesToStash}
        onStashPush={sourceControlState.state.onStashPush}
        onStashApply={sourceControlState.state.onStashApply}
        onStashPop={sourceControlState.state.onStashPop}
        onStashDrop={sourceControlState.state.onStashDrop}
        onHistorySelectionChange={onGitHistorySelectionChange}
        ahead={sourceControlState.state.ahead}
        behind={sourceControlState.state.behind}
        onSync={sourceControlState.state.onSync}
        syncLoading={sourceControlState.state.syncLoading}
        onPull={sourceControlState.state.onPull}
        pullLoading={sourceControlState.state.pullLoading}
        onPush={sourceControlState.state.onPush}
        pushLoading={sourceControlState.state.pushLoading}
        onFetch={sourceControlState.state.onFetch}
        fetchLoading={sourceControlState.state.fetchLoading}
        hasUpstream={sourceControlState.state.hasUpstream}
        onPublish={sourceControlState.state.onPublish}
        publishLoading={sourceControlState.state.publishLoading}
        onRefresh={refresh}
      />
    );
  }
);

SourceControlTabContent.displayName = "SourceControlTabContent";

// ── MainRepoSectionContent ────────────────────────────────────────────────────

export const MainRepoSectionContent = forwardRef<
  SourceControlContentHandle,
  SourceControlContentProps
>(
  (
    {
      repoPath,
      repoId,
      onGitFileSelect,
      onGitFilesChange,
      onGitHistorySelectionChange,
      showFilter,
      viewMode,
      showOnlyStashes,
      navigateWithoutSelecting,
      sectionFilter,
    },
    ref
  ) => {
    const sourceControlState = useSourceControlState({
      repoPath,
      repoId,
      onGitFileSelect,
    });

    useEffect(() => {
      onGitFilesChange?.(sourceControlState.state.files, repoPath);
    }, [onGitFilesChange, sourceControlState.state.files, repoPath]);

    const refresh = useCallback(async () => {
      await sourceControlState.refresh();
    }, [sourceControlState]);

    const sourceControlFiles = sourceControlState.state.files;
    const selectSourceControlFile = sourceControlState.state.onFileSelect;

    const handleContentFileSelect = useCallback(
      (fileId: string) => {
        if (!navigateWithoutSelecting) {
          selectSourceControlFile(fileId);
          return;
        }
        const file = sourceControlFiles.find(
          (candidate) => candidate.id === fileId
        );
        if (file) {
          onGitFileSelect?.(file);
        }
      },
      [
        navigateWithoutSelecting,
        onGitFileSelect,
        selectSourceControlFile,
        sourceControlFiles,
      ]
    );

    useImperativeHandle(ref, () => ({ refresh }), [refresh]);

    return (
      <SourceControlContent
        repoId={repoId}
        repoPath={repoPath}
        files={sourceControlState.state.files}
        filteredFiles={sourceControlState.state.filteredFiles}
        selectedFileId={
          navigateWithoutSelecting
            ? ""
            : sourceControlState.state.selectedFileId
        }
        loading={sourceControlState.loading}
        error={sourceControlState.state.error}
        onFileSelect={handleContentFileSelect}
        onStageToggle={sourceControlState.state.onStageToggle}
        onDiscard={sourceControlState.state.onDiscard}
        onDiscardFiles={sourceControlState.state.onDiscardFiles}
        onStageAll={sourceControlState.state.onStageAll}
        onUnstageAll={sourceControlState.state.onUnstageAll}
        onDiscardAll={sourceControlState.state.onDiscardAll}
        onOpenChanges={sourceControlState.state.onOpenChanges}
        onOpenStagedChanges={sourceControlState.state.onOpenStagedChanges}
        commitMessage={sourceControlState.state.commitMessage}
        onCommitMessageChange={sourceControlState.state.onCommitMessageChange}
        onCommit={sourceControlState.state.onCommit}
        onCommitAndPush={sourceControlState.state.onCommitAndPush}
        onCommitAndPublish={sourceControlState.state.onCommitAndPublish}
        onCommitAndSync={sourceControlState.state.onCommitAndSync}
        onAmend={sourceControlState.state.onAmend}
        commitLoading={sourceControlState.state.commitLoading}
        generateCommitMessageLoading={
          sourceControlState.state.generateCommitMessageLoading
        }
        onGenerateCommitMessage={
          sourceControlState.state.onGenerateCommitMessage
        }
        stagedFilesCount={sourceControlState.state.stagedFilesCount}
        branchName={sourceControlState.state.branchName}
        searchQuery={sourceControlState.state.searchQuery}
        onSearchChange={sourceControlState.state.onSearchChange}
        showFilter={showFilter}
        viewMode={viewMode}
        showOnlyStashes={showOnlyStashes}
        sectionFilter={sectionFilter}
        navigateWithoutSelecting={navigateWithoutSelecting}
        conflictFiles={sourceControlState.state.conflictFiles}
        hasConflicts={sourceControlState.state.hasConflicts}
        onStageResolved={sourceControlState.state.onStageResolved}
        isMerging={sourceControlState.state.isMerging}
        mergingBranch={sourceControlState.state.mergingBranch}
        onContinueMerge={sourceControlState.state.onContinueMerge}
        stashes={sourceControlState.state.stashes}
        stashOperationLoading={sourceControlState.state.stashOperationLoading}
        hasChangesToStash={sourceControlState.state.hasChangesToStash}
        onStashPush={sourceControlState.state.onStashPush}
        onStashApply={sourceControlState.state.onStashApply}
        onStashPop={sourceControlState.state.onStashPop}
        onStashDrop={sourceControlState.state.onStashDrop}
        onHistorySelectionChange={onGitHistorySelectionChange}
        ahead={sourceControlState.state.ahead}
        behind={sourceControlState.state.behind}
        onSync={sourceControlState.state.onSync}
        syncLoading={sourceControlState.state.syncLoading}
        onPull={sourceControlState.state.onPull}
        pullLoading={sourceControlState.state.pullLoading}
        onPush={sourceControlState.state.onPush}
        pushLoading={sourceControlState.state.pushLoading}
        onFetch={sourceControlState.state.onFetch}
        fetchLoading={sourceControlState.state.fetchLoading}
        hasUpstream={sourceControlState.state.hasUpstream}
        onPublish={sourceControlState.state.onPublish}
        publishLoading={sourceControlState.state.publishLoading}
        onRefresh={refresh}
      />
    );
  }
);

MainRepoSectionContent.displayName = "MainRepoSectionContent";

// ── SourceControlWithWorktrees ────────────────────────────────────────────────

interface SourceControlWithWorktreesProps {
  repoPath: string;
  repoId: string;
  worktrees: GitWorktreeEntry[];
  scope: SourceControlScope;
  onGitFileSelect?: (file: GitFile) => void;
  /**
   * Notified whenever the file list of any pane (host or worktree) changes.
   * `scopeRepoRoot` identifies which pane fired so the consumer can scope a
   * bulk replace to that repo only.
   */
  onGitFilesChange?: (files: GitFile[], scopeRepoRoot?: string) => void;
  onGitHistorySelectionChange?: (
    selection: SourceControlHistorySelection
  ) => void;
  showFilter: boolean;
  viewMode: "list-tree" | "list";
  showOnlyStashes?: boolean;
  navigateWithoutSelecting?: boolean;
  /** Working-tree section filter forwarded to every (sub)pane. */
  sectionFilter?: "uncommitted" | "staged" | "unstaged";
}

export const SourceControlWithWorktrees = forwardRef<
  SourceControlContentHandle,
  SourceControlWithWorktreesProps
>(
  (
    {
      repoPath,
      repoId,
      worktrees,
      scope,
      onGitFileSelect,
      onGitFilesChange,
      onGitHistorySelectionChange,
      showFilter,
      viewMode,
      showOnlyStashes,
      navigateWithoutSelecting,
      sectionFilter,
    },
    ref
  ) => {
    const handleWorktreeFilesChange = useCallback(
      (files: GitFile[], worktreePath: string) => {
        onGitFilesChange?.(files, worktreePath);
      },
      [onGitFilesChange]
    );

    const selectedWorktree =
      scope.kind === "worktree"
        ? worktrees.find((worktree) => worktree.path === scope.path)
        : undefined;

    const mainRef = useRef<SourceControlContentHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        refresh: async () => {
          await mainRef.current?.refresh();
        },
      }),
      []
    );

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {selectedWorktree ? (
          <WorktreeSourceControlSection
            worktreePath={selectedWorktree.path}
            worktreeId={`worktree:${selectedWorktree.path}`}
            onGitFileSelect={onGitFileSelect}
            onGitFilesChange={handleWorktreeFilesChange}
            showFilter={showFilter}
            viewMode={viewMode}
            navigateWithoutSelecting={navigateWithoutSelecting}
            sectionFilter={sectionFilter}
          />
        ) : (
          <MainRepoSectionContent
            ref={mainRef}
            repoPath={repoPath}
            repoId={repoId}
            onGitFileSelect={onGitFileSelect}
            onGitFilesChange={onGitFilesChange}
            onGitHistorySelectionChange={onGitHistorySelectionChange}
            showFilter={showFilter}
            viewMode={viewMode}
            showOnlyStashes={showOnlyStashes}
            navigateWithoutSelecting={navigateWithoutSelecting}
            sectionFilter={sectionFilter}
          />
        )}
      </div>
    );
  }
);

SourceControlWithWorktrees.displayName = "SourceControlWithWorktrees";
