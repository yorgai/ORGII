/**
 * Renderer wrapper for `project-dashboard` tabs.
 *
 * The project dashboard surface is wired today inside
 * `ProjectManagerContentRouter` and depends on many host callbacks
 * (`onSelectProject`, `onCreateProject`, `onOpenLinearProjects`, etc.).
 * Phase 1b renders a placeholder until those callbacks can be
 * exposed via the dispatcher context.
 *
 * TODO(phase-2): publish the project-manager action dispatcher
 * through the dispatcher context.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ProjectDashboardTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Project Dashboard")}
      hostNote="Project dashboard still rendered by ProjectManagerContentRouter. Phase 2 will expose the project-manager action dispatcher through the dispatcher context."
    />
  )
);

ProjectDashboardTabRenderer.displayName = "ProjectDashboardTabRenderer";

export default ProjectDashboardTabRenderer;
