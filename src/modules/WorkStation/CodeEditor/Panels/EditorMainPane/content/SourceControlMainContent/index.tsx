/**
 * SourceControlMainContent
 *
 * Main-pane renderer for the unified Source Control tab. The Focus / All
 * Changes pill lives in the global 40px workstation tab-header strip as the
 * primary mode selector for the tab.
 *
 * In Focus mode with a loaded file, the file breadcrumb renders in its own
 * 40px header inside the main pane directly above the diff editor.
 */
import React, { Suspense, memo } from "react";

import type { QuickAction } from "@src/modules/WorkStation/shared";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { SourceControlHistorySelection } from "@src/store/workstation/tabs";
import type { GitFile } from "@src/types/git/types";

import AllChangesView from "./AllChangesView";
import FocusView from "./FocusView";

const GitCommitDetailContent = React.lazy(
  () => import("../GitCommitDetailContent")
);

export type SourceControlPillMode = "focus" | "all-changes";

export interface SourceControlMainContentProps {
  /** Current pill mode */
  mode: SourceControlPillMode;
  // Focus mode
  /** Resolved git diff record for the focused file (null until loaded) */
  focusGitFile: GitFile | null;
  /** Whether a focus path is currently selected */
  hasFocus: boolean;
  /** Force-reload the focused file's diff */
  onForceReload?: () => void;
  /** Open the focused file as a regular file tab */
  onFileSelect?: (path: string) => void;
  /** Sync git-diff local edits to tab bar unsaved indicator */
  onGitDiffUnsavedChange?: (hasUnsaved: boolean) => void;
  /** Selected commit/stash rendered in the Source Control right pane. */
  historySelection?: SourceControlHistorySelection | null;

  // All Changes mode
  files: GitFile[];
  loading: boolean;
  staged: boolean;
  repoId?: string;
  repoPath?: string;
  collapseAllSignal?: number;
  /** Regular editor placeholder actions reused when no source-control file is focused. */
  emptyFocusActions: QuickAction[];
}

const SourceControlMainContent: React.FC<SourceControlMainContentProps> = ({
  mode,
  focusGitFile,
  hasFocus,
  onForceReload,
  onFileSelect,
  onGitDiffUnsavedChange,
  historySelection,
  files,
  loading,
  staged,
  repoId,
  repoPath,
  collapseAllSignal,
  emptyFocusActions,
}) => {
  if (historySelection) {
    const isPr = historySelection.type === "pr";
    const commitSha = isPr
      ? historySelection.selectedCommitSha
      : historySelection.commitSha;

    if (!isPr || commitSha) {
      const resolvedRepoId = repoId ?? repoPath;
      const repoReady = Boolean(repoPath && resolvedRepoId);
      const shortSha = isPr
        ? (historySelection.selectedShortSha ?? commitSha?.slice(0, 7) ?? "")
        : historySelection.shortSha;
      const commitMessage = isPr
        ? (historySelection.selectedCommitMessage ?? "")
        : historySelection.commitMessage;

      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <Suspense
            fallback={
              <Placeholder
                variant="loading"
                placement="detail-panel"
                fillParentHeight
              />
            }
          >
            <GitCommitDetailContent
              commitSha={commitSha ?? ""}
              shortSha={shortSha}
              commitMessage={commitMessage}
              repoPath={repoPath ?? ""}
              repoId={resolvedRepoId ?? ""}
              isRepoReady={repoReady}
              onFileSelect={onFileSelect}
              headerVariant={
                !isPr && historySelection.type === "stash" ? "stash" : "commit"
              }
              headerRootLabel={
                !isPr && historySelection.type === "stash"
                  ? historySelection.stashRef
                  : undefined
              }
              publishHeaderToWorkstation={false}
            />
          </Suspense>
        </div>
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {mode === "focus" ? (
        <FocusView
          gitFile={focusGitFile}
          loading={loading}
          repoPath={repoPath}
          hasFocus={hasFocus}
          onReload={onForceReload}
          onFileSelect={onFileSelect}
          onUnsavedChange={onGitDiffUnsavedChange}
          emptyActions={emptyFocusActions}
        />
      ) : (
        <AllChangesView
          files={files}
          loading={loading}
          staged={staged}
          repoId={repoId}
          repoPath={repoPath}
          onFileSelect={onFileSelect}
          collapseAllSignal={collapseAllSignal}
        />
      )}
    </div>
  );
};

SourceControlMainContent.displayName = "SourceControlMainContent";

export default memo(SourceControlMainContent);
export { AllChangesView };
export type { AllChangesViewProps } from "./AllChangesView";
