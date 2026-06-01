/**
 * Renderer wrapper for `project-org` tabs.
 *
 * Project org hub (`ProjectOrgHubContent`) is mounted by the project
 * router with org-scope navigation and tab mutators. Phase 1b cannot
 * reach those without rewriting the router.
 *
 * TODO(phase-2): expose the org-scope navigation through the
 * dispatcher context.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ProjectOrgTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Project Org")}
      hostNote="Project org hub still rendered by ProjectManagerContentRouter (needs org-scope navigation + tab mutators). Phase 2 will lift these through the dispatcher context."
    />
  )
);

ProjectOrgTabRenderer.displayName = "ProjectOrgTabRenderer";

export default ProjectOrgTabRenderer;
