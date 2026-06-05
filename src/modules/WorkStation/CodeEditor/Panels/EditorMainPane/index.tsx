/**
 * EditorContent Component
 *
 * Main content area with tabs for different view types:
 * - File editor
 * - Git diff viewer
 * - Terminal
 * - Output channels
 * - Debug console
 *
 * Architecture:
 * - TabBar is owned by AppShell (`WorkstationTabBar`).
 * - Content components (CodeViewerContent, GitDiffContent) render below
 * - Uses extracted hooks for state management and side effects
 *
 * Folder structure:
 * - content/     - Tab content renderers (CodeViewerContent, GitDiffContent, etc.)
 * - components/  - Shared subcomponents
 * - hooks/       - Extracted hooks (useEditorPaneState, useFileContentManager, etc.)
 * - types.ts     - TypeScript types
 * - config.ts    - Constants and configuration
 */
import { useActionSystem } from "@/src/modules/WorkStation/ActionSystem";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  ListChevronsDownUp,
} from "lucide-react";
import React, {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import TabPill from "@src/components/TabPill";
import { useGitStatus } from "@src/contexts/git";
import {
  usePublishWorkstationTabHeader,
  useWorkStationTabShortcutBridge,
} from "@src/hooks/workStation";
import {
  NoTabsPlaceholder,
  TabBarBottomPanelToggle,
} from "@src/modules/WorkStation/shared";
import { HEADER_ICON_SIZE } from "@src/modules/WorkStation/shared/tokens";
import { repoSelectorOpenAtom } from "@src/store/ui/overlayAtom";
import { workStationPrimarySidebarCollapsedAtom } from "@src/store/ui/workStationAtom";
import { gitReviewNavigationAtom } from "@src/store/workstation/codeEditor/gitReviewNavigationAtom";
import {
  type SourceControlHistorySelection,
  createGitCommitDetailTab,
  createStashDetailTab,
} from "@src/store/workstation/tabs";

import { CodeEditorDefaultHeader } from "./components/CodeEditorDefaultHeader";
import { createEditorQuickActions } from "./config";
import { TabContentRenderer } from "./content";
import {
  useEditorPaneState,
  useFileContentManager,
  useTabContentSync,
} from "./hooks";
import "./index.scss";
import type { EditorContentProps } from "./types";

const TerminalMainContent = React.lazy(
  () => import("./content/TerminalMainContent")
);

// ============================================
// Main Component
// ============================================

const EditorContent: React.FC<EditorContentProps> = memo(
  ({
    repoPath,
    repoId,
    repoDisplayName,
    gitFilesByPath,
    gitDiffLoading,
    onFileSelect,
    onFileSelectWithLine,
    onDiagnosticsChange,
    onCursorPositionChange,
    terminalState,
    sourceControlHeaderTrailingSlot,
    sourceControlFilterMode = "uncommitted",
    showSourceControlModePill = true,
  }) => {
    // ============================================
    // External Hooks
    // ============================================

    const { t } = useTranslation();
    const { dispatch } = useActionSystem();
    const { forceRefresh } = useGitStatus();

    // ============================================
    // File Content Manager (extracted hook)
    // ============================================

    // We need activeFilePath first, so get pane state to determine it
    const paneStateForPath = useEditorPaneState();
    const activeFilePath = useMemo(() => {
      if (paneStateForPath.activeTab?.type === "file") {
        return paneStateForPath.activeTab.data.filePath as string;
      }
      return null;
    }, [paneStateForPath.activeTab]);

    const activeFileIsCsvTable = useMemo(() => {
      if (!activeFilePath) return false;
      const lowerPath = activeFilePath.toLowerCase();
      return lowerPath.endsWith(".csv") || lowerPath.endsWith(".tsv");
    }, [activeFilePath]);

    // File content manager with handlers
    const fileContentManager = useFileContentManager({
      activeFilePath,
      onSaveSuccess: forceRefresh,
    });

    // Refs for pane state hook (needed for save-on-close)
    const fileContentStateRef = useRef(fileContentManager);
    const forceRefreshRef = useRef(forceRefresh);

    // Update refs in effect (not during render)
    useEffect(() => {
      fileContentStateRef.current = fileContentManager;
      forceRefreshRef.current = forceRefresh;
    });

    // ============================================
    // Pane State Management (extracted hook)
    // ============================================

    const { tabs, activeTabId, activeTab, closeTab, updatePaneState } =
      useEditorPaneState(fileContentStateRef, forceRefreshRef);
    const isTerminalTabActive = activeTab?.type === "terminal";

    // ============================================
    // Tab Content Sync (extracted hook - side effects only)
    // ============================================

    useTabContentSync({
      activeTab,
      hasUnsavedChanges:
        fileContentManager.isBinary || activeFileIsCsvTable
          ? activeTab?.hasUnsavedChanges === true ||
            fileContentManager.hasUnsavedChanges
          : fileContentManager.hasUnsavedChanges,
      fileLoading: fileContentManager.loading,
      fileContent: fileContentManager.content,
      updatePaneState,
    });

    // ============================================
    // Tab Handlers (use provided or default to internal)
    // ============================================

    const handleWorkStationCloseActiveEditorTab = useCallback(() => {
      if (activeTabId) void closeTab(activeTabId);
    }, [activeTabId, closeTab]);

    // Code Editor intentionally has no `onNewTab` handler: ⌘T has no
    // editor-specific meaning, and file lookup is owned by ⌘P (file
    // palette). In All-Tabs mode the unified `+` menu (TabBarPlusMenu)
    // claims ⌘T directly via its own `workstation-new-tab` listener.
    useWorkStationTabShortcutBridge({
      enabled: true,
      onCloseActiveTab: handleWorkStationCloseActiveEditorTab,
    });

    // ============================================
    // Tab Bar Handlers
    // ============================================

    const handleSearchTabTitleChange = useCallback(
      (tabId: string, query: string) => {
        const trimmedQuery = query.trim();
        const nextTitle = trimmedQuery ? `Search: ${trimmedQuery}` : "Search";

        updatePaneState((state) => {
          const tabs = state.tabs;
          const targetTab = tabs.find((tab) => tab.id === tabId);
          if (!targetTab || targetTab.title === nextTitle) {
            return state;
          }

          return {
            ...state,
            tabs: tabs.map((tab) =>
              tab.id === tabId ? { ...tab, title: nextTitle } : tab
            ),
          };
        });
      },
      [updatePaneState]
    );

    const handleGitDiffUnsavedChange = useCallback(
      (hasUnsaved: boolean) => {
        updatePaneState((state) => {
          const currentId = activeTabId;
          if (!currentId) return state;
          const targetTab = state.tabs.find((tab) => tab.id === currentId);
          if (!targetTab) return state;
          if (
            targetTab.type !== "git-diff" &&
            targetTab.type !== "source-control"
          ) {
            return state;
          }
          if (targetTab.hasUnsavedChanges === hasUnsaved) return state;
          return {
            ...state,
            tabs: state.tabs.map((tab) =>
              tab.id === currentId
                ? { ...tab, hasUnsavedChanges: hasUnsaved }
                : tab
            ),
          };
        });
      },
      [updatePaneState, activeTabId]
    );

    const handleBinaryUnsavedChange = useCallback(
      (hasUnsaved: boolean) => {
        updatePaneState((state) => {
          const currentId = activeTabId;
          if (!currentId) return state;
          const targetTab = state.tabs.find((tab) => tab.id === currentId);
          if (!targetTab || targetTab.type !== "file") return state;
          if (targetTab.hasUnsavedChanges === hasUnsaved) return state;
          return {
            ...state,
            tabs: state.tabs.map((tab) =>
              tab.id === currentId
                ? { ...tab, hasUnsavedChanges: hasUnsaved }
                : tab
            ),
          };
        });
      },
      [activeTabId, updatePaneState]
    );

    const [sourceControlCollapseAllSignal, setSourceControlCollapseAllSignal] =
      useState(0);

    const handleSourceControlModeChange = useCallback(
      (mode: "focus" | "all-changes") => {
        updatePaneState((state) => {
          const tabIndex = state.tabs.findIndex(
            (item) => item.type === "source-control"
          );
          if (tabIndex === -1) return state;
          const existing = state.tabs[tabIndex];
          if (existing.data.mode === mode && !existing.data.historySelection) {
            return state;
          }
          const nextTabs = [...state.tabs];
          nextTabs[tabIndex] = {
            ...existing,
            data: {
              ...existing.data,
              mode,
              historySelection: null,
            },
          };
          return { ...state, tabs: nextTabs };
        });
      },
      [updatePaneState]
    );

    const handleSourceControlCollapseAll = useCallback(() => {
      setSourceControlCollapseAllSignal((prev) => prev + 1);
    }, []);

    const gitReviewNavigation = useAtomValue(gitReviewNavigationAtom);

    const handleReviewPrevFile = useCallback(() => {
      document.dispatchEvent(new CustomEvent("review-prev-file"));
    }, []);

    const handleReviewNextFile = useCallback(() => {
      document.dispatchEvent(new CustomEvent("review-next-file"));
    }, []);

    const handleOpenSourceControlHistoryInNewTab = useCallback(
      (selection: SourceControlHistorySelection) => {
        const nextTab =
          selection.type === "stash"
            ? createStashDetailTab(
                selection.stashIndex,
                selection.commitMessage,
                selection.stashCommitSha
              )
            : createGitCommitDetailTab(
                selection.commitSha,
                selection.shortSha,
                selection.commitMessage
              );

        updatePaneState((state) => {
          const existing = state.tabs.find((tab) => tab.id === nextTab.id);
          const tabs = existing ? state.tabs : [...state.tabs, nextTab];
          return { ...state, tabs, activeTabId: nextTab.id };
        });
      },
      [updatePaneState]
    );

    const sourceControlHeaderContent = useMemo(() => {
      if (activeTab?.type !== "source-control") return null;
      const mode =
        activeTab.data.mode === "all-changes" ? "all-changes" : "focus";
      const historySelection = activeTab.data.historySelection as
        | SourceControlHistorySelection
        | null
        | undefined;
      const hasFocusPath = Boolean(activeTab.data.focusPath);
      const showModePill = showSourceControlModePill;
      const showCollapseAll =
        showModePill && mode === "all-changes" && !historySelection;
      const showReviewNavigation =
        showModePill &&
        mode === "focus" &&
        !historySelection &&
        hasFocusPath &&
        gitReviewNavigation.total > 0;
      return (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {sourceControlHeaderTrailingSlot}
          {showModePill && (
            <>
              <span
                className="pointer-events-none mx-1.5 h-4 w-px shrink-0 bg-border-2"
                aria-hidden
              />
              <TabPill
                activeTab={mode}
                tabs={[
                  { key: "focus", label: t("sourceControl.pill.focus") },
                  {
                    key: "all-changes",
                    label: t("sourceControl.pill.allChanges"),
                  },
                ]}
                onChange={(key) =>
                  handleSourceControlModeChange(key as "focus" | "all-changes")
                }
                variant="pill"
                color="fill"
                fillWidth={false}
                size="small"
              />
            </>
          )}

          {historySelection && (
            <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-[1px] overflow-x-auto pl-1 scrollbar-hide">
              <span className="inline-flex flex-shrink-0 whitespace-nowrap text-[13px] text-text-2">
                {historySelection.shortSha}
              </span>
              <ChevronRight
                size={14}
                strokeWidth={1.75}
                className="flex-shrink-0 text-fill-4"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">
                {historySelection.commitMessage}
              </span>
            </div>
          )}

          <span className="ml-auto flex h-7 flex-shrink-0 items-center gap-px">
            {historySelection && (
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                className="flex-shrink-0"
                onClick={() =>
                  handleOpenSourceControlHistoryInNewTab(historySelection)
                }
                title={t("common:actions.openInNewTab")}
                icon={<ArrowUpRight size={HEADER_ICON_SIZE.sm} />}
              />
            )}

            {showReviewNavigation && (
              <>
                <Button
                  htmlType="button"
                  variant="tertiary"
                  size="small"
                  iconOnly
                  onClick={handleReviewPrevFile}
                  title={t("common:actions.reviewPreviousFile")}
                  aria-label={t("common:actions.reviewPreviousFile")}
                  className="shrink-0"
                  icon={
                    <ArrowLeft size={HEADER_ICON_SIZE.sm} strokeWidth={1.75} />
                  }
                />
                <Button
                  htmlType="button"
                  variant="tertiary"
                  size="small"
                  iconOnly
                  onClick={handleReviewNextFile}
                  title={t("common:actions.reviewNextFile")}
                  aria-label={t("common:actions.reviewNextFile")}
                  className="shrink-0"
                  icon={
                    <ArrowRight size={HEADER_ICON_SIZE.sm} strokeWidth={1.75} />
                  }
                />
              </>
            )}

            {showCollapseAll && (
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                className="flex-shrink-0"
                onClick={handleSourceControlCollapseAll}
                title={t("actions.collapseAll")}
                icon={<ListChevronsDownUp size={HEADER_ICON_SIZE.md} />}
              />
            )}
            <TabBarBottomPanelToggle />
          </span>
        </div>
      );
    }, [
      activeTab,
      gitReviewNavigation.total,
      handleOpenSourceControlHistoryInNewTab,
      handleReviewNextFile,
      handleReviewPrevFile,
      handleSourceControlCollapseAll,
      handleSourceControlModeChange,
      showSourceControlModePill,
      sourceControlHeaderTrailingSlot,
      t,
    ]);

    usePublishWorkstationTabHeader({
      host: "code",
      content: sourceControlHeaderContent,
      enabled: activeTab?.type === "source-control",
    });

    const isExplorerHome = activeTab?.type === "explorer";

    // Panel state for dynamic quick action labels
    const sidebarCollapsed = useAtomValue(
      workStationPrimarySidebarCollapsedAtom
    );

    const setRepoSelectorOpen = useSetAtom(repoSelectorOpenAtom);

    const handleOpenAddWorkspace = useCallback(() => {
      setRepoSelectorOpen(true);
    }, [setRepoSelectorOpen]);

    // Quick actions from config
    const editorQuickActions = useMemo(
      () =>
        createEditorQuickActions({
          t,
          dispatch,
          sidebarCollapsed,
          onAddWorkspace: handleOpenAddWorkspace,
        }),
      [t, dispatch, sidebarCollapsed, handleOpenAddWorkspace]
    );

    // ============================================
    // Render
    // ============================================

    const hasNoTabs = tabs.length === 0;
    const shouldMountTerminalContent = isTerminalTabActive;
    // Explorer is the pinned "home" tab — its main pane reuses the same
    // empty-state placeholder we show when there are no tabs at all, so the
    // user always sees the same per-app icon + shortcut hints when they
    // have no file open.
    const showAppPlaceholder = hasNoTabs || isExplorerHome;

    return (
      <div className="code-editor-right-panel flex h-full w-full flex-col">
        <CodeEditorDefaultHeader
          enabled={isExplorerHome}
          repoDisplayName={repoDisplayName}
        />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {shouldMountTerminalContent && (
            <div
              className={`absolute inset-0 ${
                isTerminalTabActive
                  ? "z-10 opacity-100"
                  : "pointer-events-none z-0 opacity-0"
              }`}
              aria-hidden={!isTerminalTabActive}
            >
              <Suspense fallback={null}>
                <TerminalMainContent
                  terminalState={terminalState}
                  repoPath={repoPath}
                  onFileSelect={onFileSelect}
                  onFileSelectWithLine={onFileSelectWithLine}
                />
              </Suspense>
            </div>
          )}

          {!isTerminalTabActive && (
            <div className="absolute inset-0 z-10 flex min-h-0 flex-col">
              {showAppPlaceholder ? (
                <NoTabsPlaceholder icon="editor" actions={editorQuickActions} />
              ) : (
                <TabContentRenderer
                  activeTab={activeTab}
                  repoPath={repoPath}
                  repoId={repoId ?? null}
                  fileContentState={fileContentManager}
                  gitFilesByPath={gitFilesByPath}
                  gitDiffLoading={gitDiffLoading}
                  forceRefresh={forceRefresh}
                  onFileSelect={onFileSelect}
                  onDiagnosticsChange={onDiagnosticsChange}
                  onCursorPositionChange={onCursorPositionChange}
                  onSearchTabTitleChange={handleSearchTabTitleChange}
                  onGitDiffUnsavedChange={handleGitDiffUnsavedChange}
                  onBinaryUnsavedChange={handleBinaryUnsavedChange}
                  sourceControlCollapseAllSignal={
                    sourceControlCollapseAllSignal
                  }
                  sourceControlFilterMode={sourceControlFilterMode}
                  terminalState={terminalState}
                  editorQuickActions={editorQuickActions}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

EditorContent.displayName = "EditorContent";

export default EditorContent;

// Re-export types for consumers
export type { EditorContentProps } from "./types";
