/**
 * Renderer wrapper for `git-stash-detail` tabs.
 *
 * Same shape as `git-commit-detail` with a stash-flavoured header
 * (`headerVariant="stash"`). Phase 2 will share the leaf component
 * and add a `headerVariant` prop derived from `tab.type`.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const GitStashDetailTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const stashRef = String(tab.data.stashRef ?? tab.data.shortSha ?? "");
    return (
      <HostCoupledPlaceholder
        tabType="git-stash-detail"
        title={stashRef ? `Stash ${stashRef}` : "Stash"}
        hostNote="Host provides repoPath/repoId + file-select callback"
      />
    );
  }
);

GitStashDetailTabRenderer.displayName = "GitStashDetailTabRenderer";

export default GitStashDetailTabRenderer;
