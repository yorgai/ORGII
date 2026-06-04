/**
 * SourceControlTabPanels
 *
 * Internal panel components for the Source Control tab:
 * - SourceControlTabContent: wraps SourceControlContent with useSourceControlState
 * - MainRepoSectionContent: main repository content for multi-worktree layout
 * - SourceControlWithWorktrees: collapsible worktree sections
 *
 * Extracted from SourceControlTab.tsx to keep it under 600 lines.
 * PERFORMANCE (Jan 2026): useSourceControlState only runs on first mount.
 */
import { useAtomValue } from "jotai";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { removeGitWorktree } from "@src/api/http/git";
import type { GitWorktreeEntry } from "@src/api/http/git/types";
import { repoApi } from "@src/api/tauri/repo";
import Message from "@src/components/Toast";
import { FolderHeaderRow } from "@src/modules/WorkStation/shared/FolderHeaderRow";
import { FOLDER_HEADER } from "@src/modules/WorkStation/shared/tokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { workspaceGitStatusMapAtom } from "@src/store/git";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import type { GitFile } from "@src/types/git/types";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

import SourceControlContent from "../content/SourceControlContent";
import {
  WorktreeActionsMenu,
  WorktreeContextMenu,
} from "../content/WorktreeActionsMenu";
import { WorktreeSourceControlSection } from "../content/WorktreeSourceControlSection";
import { useSourceControlState } from "../hooks/useSourceControlState";

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
        prUrl={sourceControlState.state.prUrl}
        prStatus={sourceControlState.state.prStatus}
        prCreating={sourceControlState.state.prCreating}
        prErrorMessage={sourceControlState.state.prErrorMessage}
        prReadyToCreate={sourceControlState.state.prReadyToCreate}
        prEligible={sourceControlState.state.prEligible}
        autoCreatePr={sourceControlState.state.autoCreatePr}
        onCreatePr={sourceControlState.state.onCreatePr}
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
        prUrl={sourceControlState.state.prUrl}
        prStatus={sourceControlState.state.prStatus}
        prCreating={sourceControlState.state.prCreating}
        prErrorMessage={sourceControlState.state.prErrorMessage}
        prReadyToCreate={sourceControlState.state.prReadyToCreate}
        prEligible={sourceControlState.state.prEligible}
        autoCreatePr={sourceControlState.state.autoCreatePr}
        onCreatePr={sourceControlState.state.onCreatePr}
        onRefresh={refresh}
      />
    );
  }
);

MainRepoSectionContent.displayName = "MainRepoSectionContent";

async function confirmAndRemoveWorktree({
  repoId,
  repoPath,
  worktree,
  folderName,
  onRemoved,
  t,
}: {
  repoId: string;
  repoPath: string;
  worktree: GitWorktreeEntry;
  folderName: string;
  onRemoved?: () => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const confirmed = await confirmDestructiveAction({
    title: t("sourceControl.removeWorktreeTitle", { name: folderName }),
    message: t("sourceControl.removeWorktreeMessage"),
    okLabel: t("sourceControl.removeWorktree"),
  });
  if (!confirmed) return;

  try {
    await removeGitWorktree({
      repo_id: repoId,
      repo_path: repoPath,
      worktree_path: worktree.path,
      force: true,
    });
    await onRemoved?.();
    showGitActionDialogSafely(t("sourceControl.removeWorktreeSuccess"), "info");
  } catch (error) {
    showGitActionDialogSafely(
      error instanceof Error
        ? error.message
        : t("sourceControl.removeWorktreeFailed"),
      "error"
    );
  }
}

// ── SourceControlWithWorktrees ────────────────────────────────────────────────

interface SourceControlWithWorktreesProps {
  repoPath: string;
  repoId: string;
  repoName: string;
  worktrees: GitWorktreeEntry[];
  onWorktreesRefresh?: () => Promise<void>;
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
      repoName,
      worktrees,
      onWorktreesRefresh,
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
    const [mainExpanded, setMainExpanded] = useState(true);
    const [worktreeExpanded, setWorktreeExpanded] = useState<
      Record<string, boolean>
    >({});
    const [contextMenuWorktree, setContextMenuWorktree] =
      useState<GitWorktreeEntry | null>(null);

    const { t } = useTranslation();
    const gitStatusMap = useAtomValue(workspaceGitStatusMapAtom);
    const mainBranch = gitStatusMap.get(repoPath)?.current_branch;

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

    const toggleMain = useCallback(() => setMainExpanded((prev) => !prev), []);

    const toggleWorktree = useCallback((path: string) => {
      setWorktreeExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
    }, []);

    const removeWorktree = useCallback(
      async (worktree: GitWorktreeEntry) => {
        const folderName = worktree.path.split("/").pop() || "worktree";
        await confirmAndRemoveWorktree({
          repoId,
          repoPath,
          worktree,
          folderName,
          onRemoved: onWorktreesRefresh,
          t,
        });
      },
      [onWorktreesRefresh, repoId, repoPath, t]
    );

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          className={`${FOLDER_HEADER.section} flex flex-col ${
            mainExpanded ? "min-h-0 flex-1 overflow-hidden" : "flex-shrink-0"
          }`}
        >
          <FolderHeaderRow
            name={repoName}
            expanded={mainExpanded}
            onToggle={toggleMain}
            branchName={mainBranch}
          />
          {mainExpanded && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
            </div>
          )}
        </div>

        {worktrees.map((worktree) => {
          const isExpanded = worktreeExpanded[worktree.path] ?? false;
          const folderName = worktree.path.split("/").pop() || "worktree";
          return (
            <div key={worktree.path} className={FOLDER_HEADER.section}>
              <FolderHeaderRow
                name={folderName}
                expanded={isExpanded}
                onToggle={() => toggleWorktree(worktree.path)}
                branchName={worktree.branch || undefined}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenuWorktree(worktree);
                }}
                actions={
                  <WorktreeActionsMenu
                    onRemove={() => {
                      void removeWorktree(worktree);
                    }}
                  />
                }
              />
              {isExpanded && (
                <div className="flex min-h-[280px] flex-col overflow-hidden">
                  <WorktreeSourceControlSection
                    worktreePath={worktree.path}
                    worktreeId={`worktree:${worktree.path}`}
                    onGitFileSelect={onGitFileSelect}
                    onGitFilesChange={handleWorktreeFilesChange}
                    showFilter={showFilter}
                    viewMode={viewMode}
                    navigateWithoutSelecting={navigateWithoutSelecting}
                    sectionFilter={sectionFilter}
                  />
                </div>
              )}
            </div>
          );
        })}
        {contextMenuWorktree && (
          <WorktreeContextMenu
            onRemove={() => {
              void removeWorktree(contextMenuWorktree);
            }}
            onClose={() => setContextMenuWorktree(null)}
          />
        )}
      </div>
    );
  }
);

SourceControlWithWorktrees.displayName = "SourceControlWithWorktrees";
