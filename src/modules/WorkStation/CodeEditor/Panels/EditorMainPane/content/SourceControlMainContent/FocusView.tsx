/**
 * FocusView
 *
 * Single-file working-tree diff for the unified Source Control tab.
 */
import React, { Suspense, memo } from "react";

import {
  NoTabsPlaceholder,
  type QuickAction,
} from "@src/modules/WorkStation/shared";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { GitFile } from "@src/types/git/types";

const GitDiffContent = React.lazy(() => import("../GitDiffContent"));

const LazyFallback: React.FC = () => (
  <Placeholder variant="loading" placement="detail-panel" fillParentHeight />
);

export interface FocusViewProps {
  /** Selected file's git diff record (resolved by the renderer) */
  gitFile: GitFile | null;
  /** Whether focusPath is set but its diff hasn't loaded yet */
  loading: boolean;
  /** Repository path for relative path display */
  repoPath?: string;
  /** Whether a focus path is currently selected */
  hasFocus: boolean;
  /** Reload current diff */
  onReload?: () => void;
  /** Open the file as a regular file tab */
  onFileSelect?: (path: string) => void;
  /** Sync local edit state to tab bar dot */
  onUnsavedChange?: (hasUnsaved: boolean) => void;
  /** Render the file breadcrumb inside the main pane instead of the workstation header. */
  inlineFileHeader?: boolean;
  /** Regular editor placeholder actions shown when no source-control file is focused. */
  emptyActions: QuickAction[];
}

const FocusView: React.FC<FocusViewProps> = ({
  gitFile,
  loading,
  repoPath,
  hasFocus,
  onReload,
  onFileSelect,
  onUnsavedChange,
  inlineFileHeader = true,
  emptyActions,
}) => {
  if (!hasFocus) {
    return <NoTabsPlaceholder icon="editor" actions={emptyActions} />;
  }

  return (
    <Suspense fallback={<LazyFallback />}>
      <GitDiffContent
        gitFile={gitFile}
        loading={loading}
        repoPath={repoPath}
        onReload={onReload}
        onFileSelect={onFileSelect}
        onUnsavedChange={onUnsavedChange}
        publishHeaderToWorkstation={!inlineFileHeader}
      />
    </Suspense>
  );
};

export default memo(FocusView);
