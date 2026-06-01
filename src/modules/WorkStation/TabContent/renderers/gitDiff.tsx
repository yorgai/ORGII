/**
 * Renderer wrapper for `git-diff` tabs (also handles the timeline diff
 * variant where `tab.data.isTimeline === true`).
 *
 * TODO(Phase 2): Real `git-diff` rendering needs the editor host's
 * `gitFilesByPath` map, `gitDiffLoading` flag, `forceRefresh` callback,
 * `onFileSelect`, `gitReviewNavigation` atom, and the unsaved-change
 * propagation callback. Today the editor's `TabContentRenderer` owns
 * all of those and remains the live render path.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const GitDiffTabRenderer: React.FC<UnifiedTabContentProps> = memo(({ tab }) => {
  const filePath = String(tab.data.filePath ?? "");
  return (
    <HostCoupledPlaceholder
      tabType="git-diff"
      title={filePath || "Git Diff"}
      hostNote="Editor host owns gitFilesByPath + review navigation"
    />
  );
});

GitDiffTabRenderer.displayName = "GitDiffTabRenderer";

export default GitDiffTabRenderer;
