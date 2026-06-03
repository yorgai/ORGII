/**
 * CodeEditor Component
 *
 * Full-featured code editor with file tree, git integration, terminal,
 * diagnostics, and more. Extracted from AppContainer for clean separation.
 */
import { useTerminalState } from "@/src/engines/TerminalCore/hooks/useTerminalState";
import { useCodeEditorHandlers } from "@/src/hooks/workStation/editor/useCodeEditorHandlers";
import { useGitDiffState } from "@/src/hooks/workStation/git/useGitDiffState";
import { useCodeEditor } from "@/src/hooks/workStation/useCodeEditor";
import { ActionSystemProvider } from "@/src/modules/WorkStation/ActionSystem";
import { useAtomValue } from "jotai";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";

import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useEditorRepoCacheSync } from "@src/hooks/ui/tabs";
import { useWorkStationPanels } from "@src/hooks/workStation";
import { useDiagnostics } from "@src/hooks/workStation/diagnostics/useDiagnostics";
import { useCodeEditorEvents } from "@src/hooks/workStation/editor/useCodeEditorEvents";
import { useOutputChannels } from "@src/hooks/workStation/output/useOutputChannels";
import { useWorkStationTabs } from "@src/hooks/workStation/tabs";
import { usePinnedTabs } from "@src/hooks/workStation/tabs/usePinnedTabs";
import { CODE_EDITOR_CONFIG } from "@src/modules/WorkStation/CodeEditor/config";
import { type PrimarySidebarTabKey } from "@src/store/ui/workStationAtom";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";
import {
  CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
  explorerTabFactory,
  launchpadDashboardTabFactory,
  sourceControlTabFactory,
  terminalTabFactory,
} from "@src/store/workstation/tabs";

import {
  SidebarSlot,
  WorkStationShell,
  buildPrimarySidebarConfig,
  buildSecondaryPanelConfig,
} from "../shared";
// Side-effect import: registers SourceControlTabSidebar into
// TAB_SIDEBAR_REGISTRY.
import "../shared/SidebarModules";
import { EditorIntegrations } from "./EditorLayout/components/EditorIntegrations";
// Static imports — lazy loading added ~200-500ms of blank screen on first open
// because Suspense fallback={null} shows nothing while the chunk loads.
import FileSearchPanel from "./EditorLayout/overlays/FileSearchPanel";
import EditorBottomPanel from "./Panels/EditorBottomPanel";
import EditorContent from "./Panels/EditorMainPane";
import { preloadSourceControlTabContent } from "./Panels/EditorMainPane/content";
import { EditorPrimarySidebar } from "./Panels/EditorPrimarySidebar";
import { useCodeEditorLocalState } from "./useCodeEditorLocalState";
import { useSourceControlSetup } from "./useSourceControlSetup";

// ============================================
// Types
// ============================================

export interface CodeEditorProps {
  /** Repository path to browse */
  repoPath: string;
  /** Repository name for display */
  repoName: string;
  /** Whether Code Editor is currently active in AppShell */
  isActive?: boolean;
}

// ============================================
// Main Component
// ============================================

export const CodeEditor: React.FC<CodeEditorProps> = memo(
  ({ repoPath, repoName, isActive = true }) => {
    // === Repo selection (needed early for repo ID) ===
    const { currentBranch, selectedRepoId } = useRepoSelection({
      autoLoad: true,
    });

    // === Editor tab cache sync (saves file tabs per repo) ===
    useEditorRepoCacheSync();

    // === Workspace folders for multi-root support ===
    const workspaceFolders = useAtomValue(workspaceFoldersAtom);

    // === Business logic hooks ===
    const codeEditorState = useCodeEditor({
      repoPath,
      repoId: selectedRepoId || repoPath,
      autoLoad: true,
      workspaceFolders:
        workspaceFolders.length > 1 ? workspaceFolders : undefined,
    });
    const panels = useWorkStationPanels();
    const diagnosticsState = useDiagnostics();
    const outputState = useOutputChannels({ defaultMaxChars: 100000 });

    // === Terminal state (unified via Jotai atoms) ===
    const terminalState = useTerminalState();

    // === Git diff state (consolidated with useReducer) ===
    const gitDiffState = useGitDiffState();
    // Destructure state for component usage
    const {
      filesByPath: gitFilesByPath,
      loading: gitDiffLoading,
      openTabs: gitDiffTabs,
    } = gitDiffState.state;

    // The single main pane's active tab. SidebarSlot resolves tab-specific
    // sidebars further below — after `useCodeEditorHandlers` runs — so git
    // file-row clicks can be wired to `handleGitFileSelect`.
    const { activeTab } = useWorkStationTabs();

    // === Local state, status-bar sync, and misc handlers ===
    const {
      searchPanelVisible,
      setSearchPanelVisible,
      setPrimaryPanel,
      activeCommitSha,
      editorPanelPosition,
      handleCursorPositionChange,
      handleToggleEditorPanelPosition,
      handleDiagnosticsChange,
      handleDiagnosticClick,
      handleSymbolClick,
      handleAllChangesClick,
      handleKillTerminal,
      handleAddTerminal,
    } = useCodeEditorLocalState({
      repoName,
      isActive,
      currentBranch,
      codeEditorState,
      terminalState,
      diagnosticsState,
    });

    // === Extracted handlers (performance optimized) ===
    const handlers = useCodeEditorHandlers({
      repoPath,
      repoName,
      editorState: codeEditorState,
      setPrimaryPanel,
      setSearchPanelVisible,
      gitDiffState,
    });

    useEffect(() => {
      const preloadTimer = window.setTimeout(preloadSourceControlTabContent, 0);
      return () => window.clearTimeout(preloadTimer);
    }, []);

    // === Consolidated event listeners ===
    // Editor command-palette shortcuts now drive GlobalSpotlight's "Editor"
    // tab (no local palette instance required).
    useCodeEditorEvents({
      repoPath,
      isActive,
      setPrimaryPanel,
      selectedFile: codeEditorState.selectedFile,
      selectFile: codeEditorState.selectFile,
      gitDiffState: {
        setFiles: gitDiffState.setFiles,
        addTab: gitDiffState.addTab,
      },
    });

    // === Destructure handlers from extracted hook ===
    const {
      handleFileSelect,
      handleFileSelectWithLine,
      handleContentChange,
      handleSave,
      handleDiscard,
      handleDirectoryToggle,
      handleSearchClick,
      handleSearchClose,
      handleSearchChange,
      handleSearchFileSelect,
      handleFilterSearch,
      handleClearFilterSearch,
      handleTimelineCommitClick,
      handleGitFileSelect,
    } = handlers;

    const {
      sourceControlFilterMode,
      sourceControlFilterCounts,
      sourceControlHeaderFilter,
      tabSidebarExtraContext,
      handleGitFilesChange,
      handleSourceControlHistorySelectionChange,
      handleDiffSidebarFileSelect,
    } = useSourceControlSetup({
      repoPath,
      repoId: selectedRepoId,
      gitDiffState,
      activeTab,
      setPrimaryPanel,
      handleGitFileSelect,
    });

    // === Pinned tabs (always-visible icon-only tabs) ===
    // Order matters — the tab bar renders pinned tabs in this sequence,
    // so the Launchpad dashboard sits as the first fixture (its rocket
    // tile is the "home" entry for the editor surface), followed by the
    // historical trio: terminal, source control, explorer.
    const explorerTab = useMemo(() => explorerTabFactory({}), []);
    const launchpadDashboardTab = useMemo(
      () => launchpadDashboardTabFactory({}),
      []
    );
    const pinnedTabs = useMemo(
      () => [
        launchpadDashboardTab,
        terminalTabFactory({
          sessionId: CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
          sessionName: "Terminal",
        }),
        sourceControlTabFactory({
          mode: "focus",
          staged: false,
          fileCount: sourceControlFilterCounts.unstaged,
          focusPath: null,
          historySelection: null,
        }),
        explorerTab,
      ],
      [explorerTab, launchpadDashboardTab, sourceControlFilterCounts.unstaged]
    );
    usePinnedTabs({
      enabled: Boolean(repoPath),
      pinnedTabs,
      initialActiveTabId: explorerTab.id,
    });

    // Tab change from EditorPrimarySidebar
    const handleTabChange = useCallback((_tab: PrimarySidebarTabKey) => {
      // Tab changes don't affect which files are displayed
    }, []);

    const isAgentConfigTab = activeTab?.type === "agent-config";
    const sidebarVisible = !isAgentConfigTab && !panels.primarySidebarCollapsed;
    const repoDisplayName = repoName || repoPath.split("/").pop() || "Repo";

    // Primary sidebar config using unified pattern.
    // Tab-specific sidebar (e.g. Source Control tab → Source Control
    // sidebar) wins over the default explorer sidebar; if no override is
    // registered we fall through.
    const defaultSidebar = useMemo(
      () => (
        <EditorPrimarySidebar
          fileTree={codeEditorState.fileTree}
          selectedCommitSha={activeCommitSha}
          loading={codeEditorState.loading}
          error={codeEditorState.treeError}
          repoPath={repoPath}
          repoId={selectedRepoId}
          repoName={repoName}
          searchResults={codeEditorState.searchResults}
          searchLoading={codeEditorState.searchLoading}
          searchQuery={codeEditorState.searchQuery}
          onFileSelect={handleFileSelect}
          onFileSelectWithLine={handleFileSelectWithLine}
          onDirectoryToggle={handleDirectoryToggle}
          onSearchClick={handleSearchClick}
          onRefresh={codeEditorState.refresh}
          onCollapseAll={codeEditorState.collapseAll}
          onFilterSearch={handleFilterSearch}
          onClearSearch={handleClearFilterSearch}
          onTabChange={handleTabChange}
          onTimelineCommitClick={handleTimelineCommitClick}
          iconOnly={true}
          onSymbolClick={handleSymbolClick}
          onRevealFile={codeEditorState.revealFile}
          isMultiRoot={workspaceFolders.length > 1}
        />
      ),
      [
        codeEditorState.fileTree,
        activeCommitSha,
        codeEditorState.loading,
        codeEditorState.treeError,
        repoPath,
        selectedRepoId,
        repoName,
        codeEditorState.searchResults,
        codeEditorState.searchLoading,
        codeEditorState.searchQuery,
        handleFileSelect,
        handleFileSelectWithLine,
        handleDirectoryToggle,
        handleSearchClick,
        codeEditorState.refresh,
        codeEditorState.collapseAll,
        handleFilterSearch,
        handleClearFilterSearch,
        handleTabChange,
        handleTimelineCommitClick,
        handleSymbolClick,
        codeEditorState.revealFile,
        workspaceFolders.length,
      ]
    );

    const sidebarContent = useMemo(
      () => (
        <SidebarSlot
          activeTab={activeTab}
          repoPath={repoPath}
          repoId={selectedRepoId}
          isMultiRoot={workspaceFolders.length > 1}
          onGitFileSelect={handleDiffSidebarFileSelect}
          onGitFilesChange={handleGitFilesChange}
          onGitHistorySelectionChange={
            handleSourceControlHistorySelectionChange
          }
          extraContext={tabSidebarExtraContext}
          defaultSidebar={defaultSidebar}
        />
      ),
      [
        activeTab,
        defaultSidebar,
        handleDiffSidebarFileSelect,
        handleGitFilesChange,
        handleSourceControlHistorySelectionChange,
        repoPath,
        selectedRepoId,
        tabSidebarExtraContext,
        workspaceFolders.length,
      ]
    );

    const primarySidebarConfig = useMemo(
      () =>
        buildPrimarySidebarConfig({
          content: sidebarContent,
          collapsed: !sidebarVisible,
          size: sidebarVisible ? panels.primarySidebarWidth : 0,
          onSizeChange: panels.setPrimarySidebarWidth,
          onClose: panels.closePrimarySidebar,
          minSize: 240,
          maxSize: 500,
          resetSize: CODE_EDITOR_CONFIG.defaultTreeWidth,
        }),
      [
        sidebarContent,
        sidebarVisible,
        panels.primarySidebarWidth,
        panels.setPrimarySidebarWidth,
        panels.closePrimarySidebar,
      ]
    );

    const handleTerminalFileLinkOpen = useCallback(
      (filePath: string, line?: number) => {
        if (line) {
          handleFileSelectWithLine(filePath, line);
          return;
        }
        handleFileSelect(filePath);
      },
      [handleFileSelect, handleFileSelectWithLine]
    );

    const mainContent = (
      <div className="flex h-full min-h-0 w-full flex-col">
        <EditorContent
          selectedFile={codeEditorState.selectedFile}
          fileContent={codeEditorState.fileContent ?? ""}
          loading={codeEditorState.loadingContent}
          error={codeEditorState.contentError}
          repoPath={repoPath}
          repoId={selectedRepoId ?? repoPath}
          repoDisplayName={repoDisplayName}
          gitDiffTabs={gitDiffTabs}
          gitFilesByPath={gitFilesByPath}
          gitDiffLoading={gitDiffLoading}
          onFileSelect={handleFileSelect}
          onFileSelectWithLine={handleFileSelectWithLine}
          onContentChange={handleContentChange}
          onSave={handleSave}
          onDiscard={handleDiscard}
          onDiagnosticsChange={handleDiagnosticsChange}
          onAllChangesClick={handleAllChangesClick}
          hasUnsavedChanges={codeEditorState.hasUnsavedChanges}
          saving={codeEditorState.saving}
          isBinary={codeEditorState.isBinary}
          onCursorPositionChange={handleCursorPositionChange}
          terminalState={terminalState}
          sourceControlHeaderTrailingSlot={sourceControlHeaderFilter}
          sourceControlFilterMode={sourceControlFilterMode}
          showSourceControlModePill={
            sourceControlFilterMode !== "stashed" &&
            sourceControlFilterMode !== "history"
          }
        />
      </div>
    );

    const editorPanelContent = useMemo(
      () => (
        <EditorBottomPanel
          diagnostics={diagnosticsState.diagnostics}
          onDiagnosticClick={handleDiagnosticClick}
          onClearAllDiagnostics={diagnosticsState.clearAllDiagnostics}
          onSetDiagnosticsForFile={diagnosticsState.setDiagnosticsForFile}
          outputChannels={outputState.channels}
          activeChannelId={outputState.activeChannelId}
          onSetActiveChannel={outputState.setActiveChannel}
          onClearChannel={outputState.clearChannel}
          terminalState={terminalState}
          onTerminalFileLinkOpen={handleTerminalFileLinkOpen}
          onKillTerminal={handleKillTerminal}
          onAddTerminal={handleAddTerminal}
          terminalSidebarWidth={panels.terminalSidebarWidth}
          onTerminalSidebarWidthChange={panels.setTerminalSidebarWidth}
          repoPath={repoPath}
          position={editorPanelPosition}
          onTogglePosition={handleToggleEditorPanelPosition}
        />
      ),
      [
        diagnosticsState.diagnostics,
        diagnosticsState.clearAllDiagnostics,
        diagnosticsState.setDiagnosticsForFile,
        handleDiagnosticClick,
        outputState.channels,
        outputState.activeChannelId,
        outputState.setActiveChannel,
        outputState.clearChannel,
        terminalState,
        handleTerminalFileLinkOpen,
        handleKillTerminal,
        handleAddTerminal,
        panels.terminalSidebarWidth,
        panels.setTerminalSidebarWidth,
        repoPath,
        editorPanelPosition,
        handleToggleEditorPanelPosition,
      ]
    );

    // Editor panel size: bottom uses persisted bottomPanelHeight; right uses local width.
    // Single mount while visible — CSS grid swaps axis without unmounting EditorBottomPanel.
    const [editorRightPanelWidth, setEditorRightPanelWidth] = useState(400);
    const shouldHideSecondaryPanel = activeTab?.type === "terminal";
    const secondaryPanelConfig = useMemo(() => {
      if (shouldHideSecondaryPanel) return undefined;

      return buildSecondaryPanelConfig({
        content: editorPanelContent,
        position: editorPanelPosition,
        collapsed: panels.bottomPanelCollapsed,
        maximized:
          editorPanelPosition === "bottom"
            ? panels.bottomPanelMaximized
            : false,
        size:
          editorPanelPosition === "bottom"
            ? panels.bottomPanelHeight
            : editorRightPanelWidth,
        onSizeChange:
          editorPanelPosition === "bottom"
            ? panels.setBottomPanelHeight
            : setEditorRightPanelWidth,
        onClose: panels.toggleBottomPanel,
        minSize: editorPanelPosition === "bottom" ? 160 : 240,
        maxSize: 800,
        resetSize: editorPanelPosition === "bottom" ? 250 : 400,
      });
    }, [
      editorPanelContent,
      editorPanelPosition,
      panels.bottomPanelCollapsed,
      panels.bottomPanelMaximized,
      panels.bottomPanelHeight,
      panels.setBottomPanelHeight,
      editorRightPanelWidth,
      panels.toggleBottomPanel,
      shouldHideSecondaryPanel,
    ]);

    return (
      <ActionSystemProvider repoPath={repoPath} repoId={selectedRepoId}>
        <EditorIntegrations
          repoPath={repoPath}
          repoId={selectedRepoId || repoPath}
          primarySidebarTab={panels.primarySidebarTab}
          outputState={outputState}
          setBottomPanelTab={panels.setBottomPanelTab}
          bottomPanelCollapsed={panels.bottomPanelCollapsed}
          toggleBottomPanel={panels.toggleBottomPanel}
        />

        <WorkStationShell
          primarySidebarConfig={primarySidebarConfig}
          secondaryPanelConfig={secondaryPanelConfig}
          content={mainContent}
          statusBar={null}
          layoutMode={panels.layoutMode}
          appClassName="code-editor"
        />

        {searchPanelVisible && (
          <FileSearchPanel
            visible={searchPanelVisible}
            searchQuery={codeEditorState.searchQuery}
            searchResults={codeEditorState.searchResults}
            loading={codeEditorState.searchLoading}
            repoPath={repoPath}
            onSearchChange={handleSearchChange}
            onFileSelect={handleSearchFileSelect}
            onClose={handleSearchClose}
          />
        )}
      </ActionSystemProvider>
    );
  }
);

CodeEditor.displayName = "CodeEditor";

export default CodeEditor;
