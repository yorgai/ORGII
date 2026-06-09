/**
 * useSourceControlSidebarModule
 *
 * Self-contained Source Control sidebar tab. Owns its own filter state,
 * view-mode toggle, action button list, inner refs, and filter-mode dropdown
 * header (Uncommitted / Unstaged / Staged / Stashed / Git History).
 * Any sidebar (Code Editor, Control Tower peek, future tab-specific
 * sidebars) can mount it with just `repoPath` + `repoId`.
 *
 * Returns a `PrimarySidebarTab` ready to be passed to
 * `PrimarySidebarLayoutWithSections`.
 */
import { useAtomValue } from "jotai";
import { CircleDot, RotateCcw } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";
import { useGitStatus } from "@src/contexts/git";
import { sessionIdAtom } from "@src/engines/SessionCore";
import { useFileReviewBatchActions } from "@src/hooks/fileReview";
import { useRefreshSpin } from "@src/hooks/ui";
import {
  ICON_CONFIG,
  PANEL_CONSTANTS,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/config";
import GitHistoryContent from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/GitHistoryContent";
import IssuesContent from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent";
import PullRequestContent from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent";
import { useSourceControlActions } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/hooks";
import {
  type SourceControlTabHandle,
  useSourceControlTabConfig,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/tabs/SourceControlTab";
import type { PrimarySidebarTab } from "@src/modules/WorkStation/shared/PrimarySidebarLayout";
import { workstationIssueCallbackAtom } from "@src/store/workstation/codeEditor/workstationIssueAtom";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import type { GitFile } from "@src/types/git/types";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import type { SourceControlFilterMode } from "./SourceControlFilterHeader";

const HistoryRefreshIcon = ICON_CONFIG.refresh;

export interface UseSourceControlSidebarModuleOptions {
  repoPath: string;
  repoId: string;
  /** Current branch name, forwarded to PullRequestContent for display. */
  branchName?: string;
  /** Optional callback when a git file is clicked — opens diff tab in caller. */
  onGitFileSelect?: (file: GitFile) => void;
  /** Optional callback when a history node is selected for inline display. */
  onGitHistorySelectionChange?: (
    selection: SourceControlHistorySelection
  ) => void;
  /**
   * Optional callback when the sidebar's current git file list changes.
   * `scopeRepoRoot` identifies which pane reported the update (host repo or
   * a worktree path) so the consumer can scope a bulk replace.
   */
  onGitFilesChange?: (files: GitFile[], scopeRepoRoot?: string) => void;
  /** Multi-root workspace? (changes header layout to per-folder collapse rows.) */
  isMultiRoot?: boolean;
  /** Shared filter mode owned by the host header. */
  filterMode?: SourceControlFilterMode;
  /** Notify parent on row click without updating sidebar selection. */
  navigateWithoutSelecting?: boolean;
}

export interface UseSourceControlSidebarModuleResult {
  /** Drop-in `PrimarySidebarTab` config (key, label, icon, sections). */
  tab: PrimarySidebarTab;
  /** Imperative handle for `refresh()` from outside (status-bar Sync button etc.). */
  ref: React.RefObject<SourceControlTabHandle | null>;
}

export function useSourceControlSidebarModule({
  repoPath,
  repoId,
  branchName,
  onGitFileSelect,
  onGitHistorySelectionChange,
  onGitFilesChange,
  isMultiRoot = false,
  filterMode: controlledFilterMode,
  navigateWithoutSelecting = false,
}: UseSourceControlSidebarModuleOptions): UseSourceControlSidebarModuleResult {
  const { t } = useTranslation();
  const sourceControlRef = useRef<SourceControlTabHandle>(null);
  const historyRefreshRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [showFilter, setShowFilter] = useState(false);
  const [viewMode, setViewMode] = useState<"list-tree" | "list">("list-tree");
  const filterMode = controlledFilterMode ?? "uncommitted";
  const isHistoryMode = filterMode === "history";
  const isPrMode = filterMode === "pr";
  const isIssuesMode = filterMode === "issues";
  // Narrow the working-tree section filter (drop stashed/history — those
  // are routed via showOnlyStashes / sourceControlContentOverride).
  const sectionFilter: "uncommitted" | "staged" | "unstaged" =
    filterMode === "staged" || filterMode === "unstaged"
      ? filterMode
      : "uncommitted";

  const handleToggleFilter = useCallback(() => {
    setShowFilter((prev) => !prev);
  }, []);
  const handleToggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === "list-tree" ? "list" : "list-tree"));
  }, []);
  const handleRefresh = useCallback(() => {
    sourceControlRef.current?.refresh();
  }, []);
  const handleHistoryRefreshReady = useCallback((refresh: () => void) => {
    historyRefreshRef.current = refresh;
  }, []);
  const handleHistoryRefresh = useCallback(() => {
    historyRefreshRef.current?.();
  }, []);

  const sourceControlActions = useSourceControlActions({
    showFilter,
    viewMode,
    onToggleFilter: handleToggleFilter,
    onToggleViewMode: handleToggleViewMode,
    onRefresh: handleRefresh,
  });

  const {
    spinClass: historyRefreshSpinClass,
    handleClick: handleHistoryRefreshClick,
  } = useRefreshSpin(handleHistoryRefresh, false);

  const historyActions = useMemo<SectionHeaderAction[]>(
    () => [
      {
        key: "refresh-git-history",
        icon: (
          <HistoryRefreshIcon
            size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
            strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
            className={historyRefreshSpinClass}
          />
        ),
        tooltip: "",
        onClick: handleHistoryRefreshClick,
      },
    ],
    [handleHistoryRefreshClick, historyRefreshSpinClass]
  );

  const globalSessionId = useAtomValue(sessionIdAtom);
  const { pendingCount, onUndoAll } =
    useFileReviewBatchActions(globalSessionId);
  const { forceRefresh: refreshGitStatus } = useGitStatus();
  const [isUndoingAll, setIsUndoingAll] = useState(false);

  const handleUndoAll = useCallback(async () => {
    const confirmed = await confirmDestructiveAction({
      title: t("common:actions.undoAll"),
      message: t("common:confirmation.undoAllChanges", {
        count: pendingCount,
      }),
      okLabel: t("common:actions.undoAll"),
      cancelLabel: t("common:actions.cancel"),
    });
    if (!confirmed) return;
    setIsUndoingAll(true);
    try {
      await onUndoAll();
      refreshGitStatus().catch(() => {});
    } finally {
      if (mountedRef.current) setIsUndoingAll(false);
    }
  }, [t, pendingCount, onUndoAll, refreshGitStatus]);

  const undoAllAction = useMemo<SectionHeaderAction>(
    () => ({
      key: "undo-all-changes",
      icon: (
        <RotateCcw
          size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
          strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
        />
      ),
      tooltip: t("common:actions.undoAll"),
      onClick: handleUndoAll,
      forceVisible: true,
    }),
    [handleUndoAll, t]
  );

  const sourceControlActionsWithUndo = useMemo<SectionHeaderAction[]>(
    () =>
      pendingCount > 0 && !isUndoingAll
        ? [undoAllAction, ...sourceControlActions]
        : sourceControlActions,
    [pendingCount, isUndoingAll, undoAllAction, sourceControlActions]
  );

  const issueCallbacks = useAtomValue(workstationIssueCallbackAtom);
  const issueActions = useMemo<SectionHeaderAction[]>(
    () => [
      {
        key: "new-issue",
        icon: (
          <CircleDot
            size={PANEL_CONSTANTS.ACTION_ICON_SIZE}
            strokeWidth={PANEL_CONSTANTS.ACTION_ICON_STROKE}
          />
        ),
        tooltip: t("common:git.issues.newIssueTitlePlaceholder", "New issue"),
        onClick: () => {
          issueCallbacks.openNewIssueForm?.();
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issueCallbacks, t]
  );

  const actions = isHistoryMode
    ? historyActions
    : isPrMode
      ? []
      : isIssuesMode
        ? issueActions
        : sourceControlActionsWithUndo;
  const sectionTitle = isHistoryMode
    ? t("common:labels.gitHistory")
    : isPrMode
      ? t("common:labels.pullRequest", "Pull request")
      : isIssuesMode
        ? t("common:git.issues.title", "Issues")
        : t("tabs.sourceControl");

  const historyContent = useMemo(
    () => (
      <div className="flex h-full min-h-0 flex-col">
        <GitHistoryContent
          repoPath={repoPath}
          repoId={repoId}
          viewMode="graph"
          onRefreshReady={handleHistoryRefreshReady}
          onHistorySelectionChange={onGitHistorySelectionChange}
        />
      </div>
    ),
    [handleHistoryRefreshReady, onGitHistorySelectionChange, repoPath, repoId]
  );

  const prContent = useMemo(
    () => (
      <div className="flex h-full min-h-0 flex-col">
        <PullRequestContent
          branchName={branchName}
          onHistorySelectionChange={onGitHistorySelectionChange}
        />
      </div>
    ),
    [branchName, onGitHistorySelectionChange]
  );

  const issuesContent = useMemo(
    () => (
      <div className="flex h-full min-h-0 flex-col">
        <IssuesContent
          repoPath={repoPath}
          repoId={repoId}
          branchName={branchName}
        />
      </div>
    ),
    [repoPath, repoId, branchName]
  );

  const tab = useSourceControlTabConfig({
    repoPath,
    repoId,
    onGitFileSelect,
    onGitFilesChange,
    onGitHistorySelectionChange,
    showFilter,
    viewMode,
    sourceControlRef,
    actions,
    isMultiRoot,
    showOnlyStashes: filterMode === "stashed",
    sectionFilter,
    navigateWithoutSelecting,
    sourceControlTitleOverride: sectionTitle,
    sourceControlContentOverride: isPrMode
      ? prContent
      : isHistoryMode
        ? historyContent
        : isIssuesMode
          ? issuesContent
          : undefined,
  });

  return useMemo(() => ({ tab, ref: sourceControlRef }), [tab]);
}
