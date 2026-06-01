/**
 * Renderer wrapper for `project-linear-projects` tabs.
 *
 * Linear projects tab is a persistent surface inside
 * `ProjectManagerContentRouter` and depends on the same host
 * callbacks as the rest of the project family.
 *
 * TODO(phase-2): expose the linear-projects action dispatcher and
 * keep-alive cache through the dispatcher context.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ProjectLinearProjectsTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Linear Projects")}
      hostNote="Linear projects still rendered by ProjectManagerContentRouter (persistent keep-alive cache). Phase 2 will lift these through the dispatcher context."
    />
  )
);

ProjectLinearProjectsTabRenderer.displayName =
  "ProjectLinearProjectsTabRenderer";

export default ProjectLinearProjectsTabRenderer;
