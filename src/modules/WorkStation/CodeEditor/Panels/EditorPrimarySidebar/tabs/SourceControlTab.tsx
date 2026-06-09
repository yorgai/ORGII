/**
 * SourceControlTab Configuration
 *
 * Defines the Source Control tab structure. Worktrees are rendered as
 * collapsible sub-sections inside the main Source Control area, and alternate
 * views are supplied by the active Source Control filter mode.
 *
 * PERFORMANCE (Jan 2026):
 * Contains SourceControlContent component that encapsulates useSourceControlState hook.
 * This hook only runs when the Source Control tab is first visited (lazy mounting).
 */
import { useAtomValue } from "jotai";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";
import { useGitStatus } from "@src/contexts/git";
import { useRepoGitInitialization } from "@src/hooks/git";
import type { PrimarySidebarTab } from "@src/modules/WorkStation/shared/PrimarySidebarLayout";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import type { GitFile } from "@src/types/git/types";

import { ICON_CONFIG, PANEL_CONSTANTS } from "../config";
import MultiRootSourceControlContent from "../content/MultiRootSourceControlContent";
import type { MultiRootSourceControlContentHandle } from "../content/MultiRootSourceControlContent";
import { useGitWorktrees } from "../hooks/useGitWorktrees";
import type { SourceControlContentHandle } from "./SourceControlTabPanels";
import {
  NotGitInitializedContent,
  SourceControlTabContent,
  SourceControlWithWorktrees,
} from "./SourceControlTabPanels";

// ============================================
// Tab Config Hook
// ============================================

export interface SourceControlTabConfigProps {
  repoPath: string;
  repoId: string;
  onGitFileSelect?: (file: GitFile) => void;
  /**
   * Notified when any source-control pane's file list changes. The optional
   * `scopeRepoRoot` identifies which repo (host or worktree) reported the
   * update so the consumer can scope a bulk replace to that pane only and
   * leave files from other panes intact.
   */
  onGitFilesChange?: (files: GitFile[], scopeRepoRoot?: string) => void;
  onGitHistorySelectionChange?: (
    selection: SourceControlHistorySelection
  ) => void;
  showFilter: boolean;
  viewMode: "list-tree" | "list";
  sourceControlRef: React.RefObject<SourceControlContentHandle | null>;
  actions: SectionHeaderAction[];
  isMultiRoot?: boolean;
  showOnlyStashes?: boolean;
  navigateWithoutSelecting?: boolean;
  /** Working-tree section filter ("uncommitted" | "staged" | "unstaged"). */
  sectionFilter?: "uncommitted" | "staged" | "unstaged";
  /**
   * Optional override for the Source Control section's `title`. When set, it
   * replaces the plain "Source Control" string with a richer header — used by
   * callers to replace the plain Source Control title with custom content.
   */
  sourceControlTitleOverride?: React.ReactNode;
  /**
   * Optional override for the Source Control section's `content`. When set,
   * it replaces the file-list / commit-box content — used by the Diff tab's
   * filter-mode dropdown to swap to git history when "Branch" is selected.
   */
  sourceControlContentOverride?: React.ReactNode;
}

export function useSourceControlTabConfig({
  repoPath,
  repoId,
  onGitFileSelect,
  onGitFilesChange,
  onGitHistorySelectionChange,
  showFilter,
  viewMode,
  sourceControlRef,
  actions,
  isMultiRoot = false,
  showOnlyStashes = false,
  navigateWithoutSelecting = false,
  sectionFilter,
  sourceControlTitleOverride,
  sourceControlContentOverride,
}: SourceControlTabConfigProps): PrimarySidebarTab {
  const { t } = useTranslation();
  const SourceControlIcon = ICON_CONFIG.sourceControl;
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);

  const { isGitInitialized, refreshGitInitialization } =
    useRepoGitInitialization(repoPath);
  const { forceRefresh } = useGitStatus();

  const handleGitInitialized = useCallback(async () => {
    await refreshGitInitialization();
    await forceRefresh();
  }, [forceRefresh, refreshGitInitialization]);

  // Worktrees for the current repo
  const {
    worktrees,
    hasWorktrees,
    refresh: refreshWorktrees,
  } = useGitWorktrees({
    repoId,
    repoPath,
    enabled: isGitInitialized === true,
  });

  // Git History view mode: graph (with icons) or list (plain)
  // Derive repo name from path for display when worktrees exist
  const repoName = useMemo(() => {
    const segments = repoPath.replace(/\/+$/, "").split("/");
    return segments[segments.length - 1] || "Repository";
  }, [repoPath]);

  const sourceControlContent = useMemo(() => {
    if (isGitInitialized === null) {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <Placeholder
            variant="loading"
            placement="sidebar"
            title={t("placeholders.loading")}
            fillParentHeight
          />
        </div>
      );
    }

    if (isGitInitialized === false) {
      return (
        <NotGitInitializedContent
          repoPath={repoPath}
          onInitialized={handleGitInitialized}
        />
      );
    }

    if (isMultiRoot && workspaceFolders.length > 1) {
      return (
        <MultiRootSourceControlContent
          ref={
            sourceControlRef as React.RefObject<MultiRootSourceControlContentHandle>
          }
          workspaceFolders={workspaceFolders}
          repoId={repoId}
          repoPath={repoPath}
          onGitFileSelect={onGitFileSelect}
          onGitFilesChange={onGitFilesChange}
          onGitHistorySelectionChange={onGitHistorySelectionChange}
          showFilter={showFilter}
          viewMode={viewMode}
          worktrees={worktrees}
          onWorktreesRefresh={refreshWorktrees}
          navigateWithoutSelecting={navigateWithoutSelecting}
          sectionFilter={sectionFilter}
        />
      );
    }
    if (hasWorktrees) {
      return (
        <SourceControlWithWorktrees
          ref={sourceControlRef}
          repoPath={repoPath}
          repoId={repoId}
          repoName={repoName}
          worktrees={worktrees}
          onWorktreesRefresh={refreshWorktrees}
          onGitFileSelect={onGitFileSelect}
          onGitFilesChange={onGitFilesChange}
          onGitHistorySelectionChange={onGitHistorySelectionChange}
          showFilter={showFilter}
          viewMode={viewMode}
          showOnlyStashes={showOnlyStashes}
          navigateWithoutSelecting={navigateWithoutSelecting}
          sectionFilter={sectionFilter}
        />
      );
    }
    return (
      <SourceControlTabContent
        ref={sourceControlRef}
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
    );
  }, [
    isGitInitialized,
    handleGitInitialized,
    isMultiRoot,
    workspaceFolders,
    repoPath,
    repoId,
    repoName,
    onGitFileSelect,
    onGitFilesChange,
    onGitHistorySelectionChange,
    showFilter,
    viewMode,
    showOnlyStashes,
    navigateWithoutSelecting,
    sectionFilter,
    sourceControlRef,
    worktrees,
    hasWorktrees,
    refreshWorktrees,
    t,
  ]);

  return useMemo(
    () => ({
      key: "source-control",
      label: t("tabs.sourceControl"),
      icon: <SourceControlIcon size={PANEL_CONSTANTS.TAB_ICON_SIZE} />,
      sections: [
        {
          key: "source-control",
          title:
            isGitInitialized === true
              ? (sourceControlTitleOverride ?? t("tabs.sourceControl"))
              : t("tabs.sourceControl"),
          content:
            isGitInitialized === true
              ? (sourceControlContentOverride ?? sourceControlContent)
              : sourceControlContent,
          defaultFlexGrow: 1,
          collapsible: true,
          resizable: true,
          actions: isGitInitialized === true ? actions : [],
        },
      ],
    }),
    [
      sourceControlContent,
      sourceControlTitleOverride,
      sourceControlContentOverride,
      actions,
      isGitInitialized,
      SourceControlIcon,
      t,
    ]
  );
}

// Re-export handle type for external use
export type { SourceControlContentHandle as SourceControlTabHandle };
