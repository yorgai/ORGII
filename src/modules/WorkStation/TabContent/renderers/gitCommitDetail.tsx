/**
 * Renderer wrapper for `git-commit-detail` tabs.
 *
 * The leaf `GitCommitDetailContent` accepts repoPath / repoId / commit
 * metadata as plain props, so this wrapper can be self-contained once
 * we pull `repoPath` from `currentRepoAtom`. Phase 1b still defers the
 * actual render to the host renderers (editor + project) — this stub
 * stays a placeholder so verification step 4 (no imports) holds.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const GitCommitDetailTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const shortSha = String(tab.data.shortSha ?? "");
    return (
      <HostCoupledPlaceholder
        tabType="git-commit-detail"
        title={shortSha ? `Commit ${shortSha}` : "Commit"}
        hostNote="Host provides repoPath/repoId + file-select callback"
      />
    );
  }
);

GitCommitDetailTabRenderer.displayName = "GitCommitDetailTabRenderer";

export default GitCommitDetailTabRenderer;
