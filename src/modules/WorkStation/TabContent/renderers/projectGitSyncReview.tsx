/**
 * Renderer wrapper for `project-git-sync-review` tabs.
 *
 * `ProjectGitSyncReviewContent` is lazy-loaded inside the project
 * router and depends on `onProjectListRefreshRequested`. Phase 1b
 * cannot reach that callback without rewiring the router.
 *
 * TODO(phase-2): expose the project-list refresh callback through
 * the dispatcher context.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ProjectGitSyncReviewTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Git Sync Review")}
      hostNote="Project git sync review still rendered by ProjectManagerContentRouter (needs project-list refresh callback). Phase 2 will lift this through the dispatcher context."
    />
  )
);

ProjectGitSyncReviewTabRenderer.displayName = "ProjectGitSyncReviewTabRenderer";

export default ProjectGitSyncReviewTabRenderer;
