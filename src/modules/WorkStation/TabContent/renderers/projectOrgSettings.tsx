/**
 * Renderer wrapper for `project-org-settings` tabs.
 *
 * Org settings shares the org-scope navigation surface with
 * `project-org`. Same Phase 2 plan.
 *
 * TODO(phase-2): consume org-scope navigation through the dispatcher
 * context.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ProjectOrgSettingsTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Project Org Settings")}
      hostNote="Project org settings still rendered by ProjectManagerContentRouter (needs org-scope navigation). Phase 2 will lift this through the dispatcher context."
    />
  )
);

ProjectOrgSettingsTabRenderer.displayName = "ProjectOrgSettingsTabRenderer";

export default ProjectOrgSettingsTabRenderer;
