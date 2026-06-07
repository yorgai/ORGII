/**
 * TabContentRenderer Component
 *
 * Renders the appropriate content based on the active tab type.
 * Extracted from EditorContent to keep the main component lean.
 *
 * Supported tab types:
 * - file: Code editor with file content
 * - git-diff: Historical / snapshot single-file diff (Timeline, commit-detail)
 * - source-control: Unified working-tree diff tab (Focus + All Changes pill)
 * - git-log: Git error log display
 * - terminal, output: Empty placeholders (rendered via Placeholder component)
 * - settings: Editor settings panel
 */
import React, { Suspense, memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import UnifiedTabContent from "@src/modules/WorkStation/TabContent/UnifiedTabContent";
import { REGISTRY } from "@src/modules/WorkStation/TabContent/registry";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { SearchOptions as StoreSearchOptions } from "@src/store/workstation/codeEditor/search";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import type { SubagentDetailTabData } from "@src/store/workstation/tabs/types";
import type { GitFile } from "@src/types/git/types";
import { requiresFilePreviewRoute as shouldUseDedicatedPreviewRoute } from "@src/util/file/previewTypes";

import type { TabContentRendererProps } from "./types";

// Lazy-load heavy components to avoid parsing on initial load
const CodeViewerContent = React.lazy(() => import("../CodeViewerContent"));
const loadSourceControlMainContent = () =>
  import("../SourceControlMainContent");
const loadGitDiffContent = () => import("../GitDiffContent");
const SourceControlMainContent = React.lazy(loadSourceControlMainContent);
const GitDiffContent = React.lazy(loadGitDiffContent);
const SearchEditorContent = React.lazy(() => import("../SearchEditorContent"));
const GitCommitDetailContent = React.lazy(
  () => import("../GitCommitDetailContent")
);
const LintScanContent = React.lazy(() => import("../LintScanContent"));
const AIImpactContent = React.lazy(() => import("../AIImpactContent"));
const BenchmarkRenderer = React.lazy(
  () => import("@src/modules/WorkStation/TabContent/renderers/benchmark")
);
const SubagentDetailTab = React.lazy(() => import("../SubagentDetailTab"));
const TerminalMainContent = React.lazy(() => import("../TerminalMainContent"));
const UrlPreviewContent = React.lazy(() => import("../UrlPreviewContent"));
const DirectoryExplorerContent = React.lazy(
  () => import("../DirectoryExplorerContent")
);
const EditorSettings = React.lazy(
  () => import("@src/modules/WorkStation/Settings")
);
const ChatView = React.lazy(() => import("@src/engines/ChatPanel/ChatView"));
const LaunchpadRepoRenderer = React.lazy(
  () => import("@src/modules/WorkStation/TabContent/renderers/launchpadRepo")
);

export function preloadSourceControlTabContent(): void {
  void loadSourceControlMainContent();
  void loadGitDiffContent();
}

/** Lightweight fallback shown while lazy chunks load */
const LazyFallback = () => (
  <Placeholder variant="loading" placement="detail-panel" fillParentHeight />
);

// ============================================
// Helpers
// ============================================

function isCsvTableFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return lowerPath.endsWith(".csv") || lowerPath.endsWith(".tsv");
}

// ============================================
// Component Implementation
// ============================================

const TabContentRenderer: React.FC<TabContentRendererProps> = memo(
  ({
    activeTab,
    repoPath,
    repoId,
    fileContentState,
    gitFilesByPath,
    gitDiffLoading,
    forceRefresh,
    onFileSelect,
    onDiagnosticsChange,
    onCursorPositionChange,
    onSearchTabTitleChange,
    onGitDiffUnsavedChange,
    onBinaryUnsavedChange,
    sourceControlCollapseAllSignal,
    sourceControlFilterMode = "uncommitted",
    terminalState,
    editorQuickActions,
  }) => {
    const { t } = useTranslation();
    // ============================================
    // Memoized values for git-diff tab
    // ============================================
    const gitDiffData = useMemo(() => {
      if (activeTab?.type !== "git-diff") return null;

      const gitFileKey = activeTab.data.isTimeline
        ? activeTab.id
        : (activeTab.data.filePath as string);
      const gitFile = gitFilesByPath.get(gitFileKey) || null;

      return { gitFile };
    }, [activeTab, gitFilesByPath]);

    // Memoized callback for search result click
    const handleSearchResultClick = useCallback(
      (filePath: string, _line: number, _column?: number) => {
        // Navigate to file at specific line
        onFileSelect?.(filePath);
        // TODO: Add line number navigation support
      },
      [onFileSelect]
    );

    // No active tab - show empty editor
    if (!activeTab) {
      return (
        <Suspense fallback={<LazyFallback />}>
          <CodeViewerContent
            selectedFile={null}
            fileContent=""
            loading={false}
            error={null}
            repoPath={repoPath}
            onFileSelect={onFileSelect}
            onContentChange={fileContentState.handleContentChange}
            onSave={fileContentState.handleSave}
            onDiscard={fileContentState.handleDiscard}
            onReload={fileContentState.handleReload}
            hasUnsavedChanges={false}
            saving={false}
            requiresFilePreviewRoute={false}
            onDiagnosticsChange={onDiagnosticsChange}
            onCursorPositionChange={onCursorPositionChange}
          />
        </Suspense>
      );
    }

    switch (activeTab.type) {
      // Explorer is the pinned "home" tab; the sidebar shows the file
      // tree, the main pane shows the same empty editor as when there is
      // no active tab at all. Without this case the renderer fell through
      // to `default` and showed the unknown-tab-type error.
      case "explorer":
        return (
          <Suspense fallback={<LazyFallback />}>
            <CodeViewerContent
              selectedFile={null}
              fileContent=""
              loading={false}
              error={null}
              repoPath={repoPath}
              onFileSelect={onFileSelect}
              onContentChange={fileContentState.handleContentChange}
              onSave={fileContentState.handleSave}
              onDiscard={fileContentState.handleDiscard}
              onReload={fileContentState.handleReload}
              hasUnsavedChanges={false}
              saving={false}
              requiresFilePreviewRoute={false}
              onDiagnosticsChange={onDiagnosticsChange}
              onCursorPositionChange={onCursorPositionChange}
            />
          </Suspense>
        );

      case "directory":
        return (
          <Suspense fallback={<LazyFallback />}>
            <DirectoryExplorerContent
              key={String(activeTab.data.directoryPath ?? "")}
              directoryPath={String(activeTab.data.directoryPath ?? "")}
              repoPath={repoPath}
              onFileSelect={onFileSelect}
            />
          </Suspense>
        );

      case "file": {
        const filePath = activeTab.data.filePath as string;
        // Look up git info for this file to get the base content (HEAD version)
        const gitFileInfo = filePath ? gitFilesByPath.get(filePath) : undefined;

        // Check if file was deleted (exists in git but removed from disk)
        // Also treat as deleted if we have git info with oldContent and file read failed
        const isDeletedFile =
          gitFileInfo?.status === "deleted" ||
          (fileContentState.error?.type === "not_found" &&
            gitFileInfo?.oldContent !== undefined);

        // Determine baseline for dirty diff:
        // - Deleted files: show oldContent with all lines marked as deleted
        // - Files in git status with "added": use "" to show all lines as green
        // - Files in git status with changes: use oldContent (HEAD version)
        // - Files not in git status: undefined → falls back to fileContent for unsaved changes
        const gitBaseContent = gitFileInfo
          ? gitFileInfo.status === "added"
            ? "" // Untracked file - compare against empty to show all green
            : gitFileInfo.status === "deleted"
              ? "" // Deleted file - compare against empty (we'll mark all as deleted)
              : gitFileInfo.oldContent
          : undefined;

        // For deleted files, show the old content instead of trying to read from disk
        const displayContent = isDeletedFile
          ? (gitFileInfo?.oldContent ?? "")
          : fileContentState.content;

        // Saved-on-disk content for unsaved changes diff (when file not in git status)
        const savedContent = isDeletedFile
          ? undefined
          : fileContentState.originalContent;

        return (
          <Suspense fallback={<LazyFallback />}>
            <CodeViewerContent
              selectedFile={filePath}
              fileContent={displayContent}
              loading={isDeletedFile ? false : fileContentState.loading}
              error={isDeletedFile ? null : fileContentState.error}
              repoPath={repoPath}
              onFileSelect={onFileSelect}
              onContentChange={fileContentState.handleContentChange}
              onSave={fileContentState.handleSave}
              onDiscard={fileContentState.handleDiscard}
              onReload={fileContentState.handleReload}
              hasUnsavedChanges={
                isDeletedFile
                  ? false
                  : isCsvTableFile(filePath)
                    ? activeTab.hasUnsavedChanges === true ||
                      fileContentState.hasUnsavedChanges
                    : fileContentState.hasUnsavedChanges
              }
              saving={isDeletedFile ? false : fileContentState.saving}
              requiresFilePreviewRoute={
                isDeletedFile
                  ? false
                  : fileContentState.isBinary ||
                    shouldUseDedicatedPreviewRoute(filePath)
              }
              defaultPreviewMode={activeTab.data.defaultPreviewMode as boolean}
              contentReady={
                isDeletedFile ? true : fileContentState.contentReady
              }
              onDiagnosticsChange={onDiagnosticsChange}
              onCursorPositionChange={onCursorPositionChange}
              onSaveSuccess={forceRefresh}
              onBinaryUnsavedChange={onBinaryUnsavedChange}
              gitBaseContent={gitBaseContent}
              savedContent={savedContent}
              isDeletedFile={isDeletedFile}
            />
          </Suspense>
        );
      }

      case "git-diff": {
        return (
          <Suspense fallback={<LazyFallback />}>
            <GitDiffContent
              gitFile={gitDiffData?.gitFile || null}
              loading={gitDiffLoading}
              repoPath={repoPath}
              onReload={forceRefresh}
              onFileSelect={onFileSelect}
              onUnsavedChange={onGitDiffUnsavedChange}
            />
          </Suspense>
        );
      }

      case "source-control": {
        const mode = (activeTab.data.mode ?? "focus") as
          | "focus"
          | "all-changes";
        const staged = Boolean(activeTab.data.staged);
        const focusPath = (activeTab.data.focusPath ?? null) as string | null;
        const historySelection =
          (activeTab.data.historySelection as
            | SourceControlHistorySelection
            | null
            | undefined) ?? null;

        const gitStatusFiles = Array.from(gitFilesByPath.values()).filter(
          (file) => {
            if (sourceControlFilterMode === "staged") return file.staged;
            if (sourceControlFilterMode === "unstaged") return !file.staged;
            return true;
          }
        );
        const embeddedFiles = (activeTab.data.files ?? []) as GitFile[];
        const filteredEmbeddedFiles = embeddedFiles.filter((file) => {
          if (sourceControlFilterMode === "staged") return file.staged;
          if (sourceControlFilterMode === "unstaged") return !file.staged;
          return true;
        });
        const allFiles =
          gitStatusFiles.length > 0 ? gitStatusFiles : filteredEmbeddedFiles;

        // `focusPath` is stored as an absolute path (set by
        // `handleGitFileSelect`), but the global git-status map is keyed by
        // the repo-relative paths emitted by `useGitFiles`. Look up by both
        // so the focused file survives the periodic git-status refresh that
        // overwrites the map and would otherwise blank the diff for one
        // render until the next user interaction.
        //
        // Worktrees: files are stored under their worktree-relative path and
        // carry `repoRoot = worktreePath`. Strip the matching repoRoot prefix
        // (not necessarily the host repoPath) to produce the correct key.
        let focusGitFile: GitFile | null = null;
        if (focusPath) {
          // 1. Try exact match (unlikely but cheap)
          focusGitFile = gitFilesByPath.get(focusPath) ?? null;

          if (!focusGitFile) {
            // 2. Try stripping the host repoPath prefix
            const hostRelative =
              repoPath && focusPath.startsWith(repoPath + "/")
                ? focusPath.slice(repoPath.length + 1)
                : null;
            if (hostRelative) {
              focusGitFile = gitFilesByPath.get(hostRelative) ?? null;
            }
          }

          if (!focusGitFile) {
            // 3. Worktree: scan map for any file whose repoRoot is a prefix of
            //    focusPath and whose relative path matches the remainder.
            for (const file of gitFilesByPath.values()) {
              if (!file.repoRoot) continue;
              const prefix = file.repoRoot + "/";
              if (!focusPath.startsWith(prefix)) continue;
              const candidate = focusPath.slice(prefix.length);
              if (file.path === candidate) {
                focusGitFile = file;
                break;
              }
            }
          }
        }

        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <SourceControlMainContent
                mode={mode}
                focusGitFile={focusGitFile}
                hasFocus={Boolean(focusPath)}
                onForceReload={forceRefresh}
                onFileSelect={onFileSelect}
                onGitDiffUnsavedChange={onGitDiffUnsavedChange}
                historySelection={historySelection}
                files={allFiles}
                loading={gitDiffLoading && allFiles.length === 0}
                staged={staged}
                repoId={repoId ?? undefined}
                repoPath={repoPath}
                collapseAllSignal={sourceControlCollapseAllSignal}
                emptyFocusActions={editorQuickActions}
              />
            </Suspense>
          </div>
        );
      }

      case "git-commit-detail": {
        const commitSha = String(activeTab.data.commitSha || "");
        const commitShortSha = String(activeTab.data.shortSha || "");
        const commitMsg = String(activeTab.data.commitMessage || "");
        const resolvedRepoId = repoId ?? repoPath;
        const repoReady = Boolean(repoPath && resolvedRepoId);

        return (
          <Suspense fallback={<LazyFallback />}>
            <GitCommitDetailContent
              commitSha={commitSha}
              shortSha={commitShortSha}
              commitMessage={commitMsg}
              repoPath={repoPath}
              repoId={resolvedRepoId}
              isRepoReady={repoReady}
              onFileSelect={onFileSelect}
            />
          </Suspense>
        );
      }

      case "git-stash-detail": {
        const commitSha = String(activeTab.data.commitSha || "");
        const commitShortSha = String(activeTab.data.shortSha || "");
        const commitMsg = String(activeTab.data.commitMessage || "");
        const stashRef = String(activeTab.data.stashRef || commitShortSha);
        const resolvedRepoId = repoId ?? repoPath;
        const repoReady = Boolean(repoPath && resolvedRepoId);

        return (
          <Suspense fallback={<LazyFallback />}>
            <GitCommitDetailContent
              commitSha={commitSha}
              shortSha={commitShortSha}
              commitMessage={commitMsg}
              repoPath={repoPath}
              repoId={resolvedRepoId}
              isRepoReady={repoReady}
              onFileSelect={onFileSelect}
              headerVariant="stash"
              headerRootLabel={stashRef}
            />
          </Suspense>
        );
      }

      case "git-log": {
        const operation = String(activeTab.data.operation || "unknown");
        const errorMessage = String(activeTab.data.errorMessage || "");
        const commandOutput = activeTab.data.commandOutput
          ? String(activeTab.data.commandOutput)
          : undefined;
        const timestamp = activeTab.data.timestamp
          ? String(activeTab.data.timestamp)
          : undefined;
        const virtualFileName =
          activeTab.data.virtualFileName || activeTab.title || "git-error";

        const errorTime = timestamp ? new Date(timestamp) : new Date();
        const lines: string[] = [
          `═══════════════════════════════════════════════════════════════`,
          `  Git ${operation.charAt(0).toUpperCase() + operation.slice(1)} Failed`,
          `  ${errorTime.toLocaleString()}`,
          `═══════════════════════════════════════════════════════════════`,
          ``,
          `Message:`,
          `─────────────────────────────────────────────────────────────────`,
          errorMessage,
          `─────────────────────────────────────────────────────────────────`,
          ``,
        ];
        if (commandOutput && commandOutput !== errorMessage) {
          lines.push(
            `Command Output:`,
            `─────────────────────────────────────────────────────────────────`,
            commandOutput,
            `─────────────────────────────────────────────────────────────────`
          );
        }
        const gitLogContent = lines.join("\n");

        return (
          <Suspense fallback={<LazyFallback />}>
            <CodeViewerContent
              selectedFile={String(virtualFileName)}
              fileContent={gitLogContent}
              loading={false}
              error={null}
              repoPath=""
              readOnly={true}
            />
          </Suspense>
        );
      }

      case "terminal-content": {
        const terminalContent = String(activeTab.data.content || "");
        const terminalName =
          activeTab.data.terminalName || activeTab.title || "Terminal Output";

        return (
          <Suspense fallback={<LazyFallback />}>
            <CodeViewerContent
              selectedFile={String(terminalName)}
              fileContent={terminalContent}
              loading={false}
              error={null}
              repoPath=""
              readOnly={true}
            />
          </Suspense>
        );
      }

      case "terminal":
        return (
          <Suspense fallback={<LazyFallback />}>
            <TerminalMainContent
              terminalState={terminalState}
              repoPath={repoPath}
            />
          </Suspense>
        );

      case "output":
        return (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t("placeholders.outputChannelLabel", {
              channelName: String(activeTab.data.channelName),
            })}
            fillParentHeight
          />
        );

      case "settings":
        return (
          <Suspense fallback={<LazyFallback />}>
            <EditorSettings />
          </Suspense>
        );

      case "search":
        return (
          <Suspense fallback={<LazyFallback />}>
            <SearchEditorContent
              key={activeTab.id}
              sessionScopeId={activeTab.id}
              repoPath={repoPath}
              initialQuery={String(activeTab.data.initialQuery || "")}
              initialOptions={
                activeTab.data.initialOptions as StoreSearchOptions
              }
              onQueryChangeForTitle={onSearchTabTitleChange}
              onResultClick={handleSearchResultClick}
            />
          </Suspense>
        );

      case "lint-scan":
        return (
          <Suspense fallback={<LazyFallback />}>
            <LintScanContent repoPath={repoPath} />
          </Suspense>
        );

      case "ai-impact":
        return (
          <Suspense fallback={<LazyFallback />}>
            <AIImpactContent />
          </Suspense>
        );

      case "benchmark":
        return (
          <Suspense fallback={<LazyFallback />}>
            <BenchmarkRenderer tab={activeTab} paneId="main" isActive />
          </Suspense>
        );

      case "subagent-detail":
        return (
          <Suspense fallback={<LazyFallback />}>
            <SubagentDetailTab
              data={activeTab.data as unknown as SubagentDetailTabData}
            />
          </Suspense>
        );

      case "chat-session": {
        const chatSessionId = String(activeTab.data.sessionId || "");
        if (!chatSessionId) return null;
        return (
          <Suspense fallback={<LazyFallback />}>
            <div
              data-chat-panel
              className="flex h-full min-w-0 flex-1 flex-col overflow-hidden text-sm"
              style={{
                background:
                  "linear-gradient(180deg, var(--color-bg-1) 0%, var(--color-fill-1) 100%)",
              }}
            >
              <ChatView sessionId={chatSessionId} readOnly />
            </div>
          </Suspense>
        );
      }

      case "url-preview": {
        const previewUrl = String(activeTab.data.url || "");
        const previewTitle = activeTab.data.title
          ? String(activeTab.data.title)
          : undefined;
        return (
          <Suspense fallback={<LazyFallback />}>
            <UrlPreviewContent url={previewUrl} title={previewTitle} />
          </Suspense>
        );
      }

      case "launchpad-repo":
        return (
          <Suspense fallback={<LazyFallback />}>
            <LaunchpadRepoRenderer tab={activeTab} paneId="main" isActive />
          </Suspense>
        );

      default:
        if (REGISTRY[activeTab.type]) {
          return <UnifiedTabContent tab={activeTab} paneId="main" isActive />;
        }
        return (
          <Placeholder
            variant="error"
            placement="detail-panel"
            title={t("placeholders.unknownTabType")}
            fillParentHeight
          />
        );
    }
  }
);

TabContentRenderer.displayName = "TabContentRenderer";

export default TabContentRenderer;
export type { TabContentRendererProps } from "./types";
