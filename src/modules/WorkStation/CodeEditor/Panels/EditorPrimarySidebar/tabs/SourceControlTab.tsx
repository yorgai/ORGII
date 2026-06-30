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
import { ChevronDown, Folder } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Dropdown from "@src/components/Dropdown";
import type { DropdownOption } from "@src/components/Dropdown/types";
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

type SourceControlScope =
  | { kind: "local" }
  | { kind: "worktree"; path: string };

function worktreeLabel(path: string): string {
  return path.split("/").pop() || "worktree";
}

function SourceControlScopePicker({
  repoName,
  branchLabel,
  repoPath,
  worktrees,
  scope,
  onScopeChange,
}: {
  repoName: string;
  branchLabel: string;
  repoPath: string;
  worktrees: Array<{ path: string; branch: string }>;
  scope: SourceControlScope;
  onScopeChange: (scope: SourceControlScope) => void;
}) {
  const selectedWorktree =
    scope.kind === "worktree"
      ? worktrees.find((worktree) => worktree.path === scope.path)
      : undefined;
  const activeLabel = selectedWorktree?.branch || branchLabel;
  const value = scope.kind === "worktree" ? scope.path : "__local__";
  const options = useMemo<DropdownOption[]>(
    () => [
      {
        value: "__local__",
        label: (
          <span className="inline-flex min-w-0 items-center gap-2">
            <Folder size={14} className="shrink-0 text-text-3" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{repoName}</span>
              <span className="block truncate text-[11px] text-text-4">
                {repoPath}
              </span>
            </span>
            <span className="max-w-[96px] shrink-0 truncate text-[11px] text-text-4">
              {branchLabel}
            </span>
          </span>
        ),
        triggerLabel: branchLabel,
      },
      ...worktrees.map((worktree) => ({
        value: worktree.path,
        label: (
          <span className="inline-flex min-w-0 items-center gap-2">
            <Folder size={14} className="shrink-0 text-text-3" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {worktreeLabel(worktree.path)}
              </span>
              <span className="block truncate text-[11px] text-text-4">
                {worktree.path}
              </span>
            </span>
            <span className="max-w-[96px] shrink-0 truncate text-[11px] text-text-4">
              {worktree.branch}
            </span>
          </span>
        ),
        triggerLabel: worktreeLabel(worktree.path),
      })),
    ],
    [branchLabel, repoName, repoPath, worktrees]
  );

  const handleSelectScope = useCallback(
    (nextValue: string | number | (string | number)[]) => {
      if (Array.isArray(nextValue)) return;
      const selectedValue = String(nextValue);
      onScopeChange(
        selectedValue === "__local__"
          ? { kind: "local" }
          : { kind: "worktree", path: selectedValue }
      );
    },
    [onScopeChange]
  );

  return (
    <Dropdown
      options={options}
      value={value}
      onSelect={handleSelectScope}
      trigger="click"
      position="bottom-end"
      getPopupContainer={() => document.body}
      avoidViewportOverflow
      style={{ width: 360 }}
    >
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-text-3 hover:bg-fill-2 hover:text-text-1"
        title={activeLabel}
        aria-label={activeLabel}
      >
        <ChevronDown size={13} />
      </button>
    </Dropdown>
  );
}

// ============================================
// Tab Config Hook
// ============================================

export interface SourceControlTabConfigProps {
  repoPath: string;
  repoId: string;
  branchName?: string;
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
  branchName,
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

  const [sourceControlScope, setSourceControlScope] =
    useState<SourceControlScope>({ kind: "local" });

  // Git History view mode: graph (with icons) or list (plain)
  // Derive repo name from path for display when worktrees exist
  const repoName = useMemo(() => {
    const segments = repoPath.replace(/\/+$/, "").split("/");
    return segments[segments.length - 1] || "Repository";
  }, [repoPath]);

  const selectedWorktree = useMemo(
    () =>
      sourceControlScope.kind === "worktree"
        ? worktrees.find(
            (worktree) => worktree.path === sourceControlScope.path
          )
        : undefined,
    [sourceControlScope, worktrees]
  );
  const effectiveScope = useMemo<SourceControlScope>(
    () => (selectedWorktree ? sourceControlScope : { kind: "local" }),
    [selectedWorktree, sourceControlScope]
  );

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
          selectedWorktreePath={
            effectiveScope.kind === "worktree" ? effectiveScope.path : undefined
          }
          scopePicker={
            <SourceControlScopePicker
              repoName={repoName}
              branchLabel={branchName || repoName}
              repoPath={repoPath}
              worktrees={worktrees}
              scope={effectiveScope}
              onScopeChange={setSourceControlScope}
            />
          }
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
    effectiveScope,
    branchName,
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
