/**
 * Renderer wrapper for `project-linear-work-items` tabs.
 *
 * Linear work items tab is also part of the persistent keep-alive
 * cluster inside `ProjectManagerContentRouter`. Same Phase 2 plan
 * as the other linear / project surfaces.
 *
 * TODO(phase-2): expose the linear-work-items action dispatcher
 * through the dispatcher context.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ProjectLinearWorkItemsTabRenderer: React.FC<UnifiedTabContentProps> =
  memo(({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Linear Work Items")}
      hostNote="Linear work items still rendered by ProjectManagerContentRouter (persistent keep-alive cache). Phase 2 will lift these through the dispatcher context."
    />
  ));

ProjectLinearWorkItemsTabRenderer.displayName =
  "ProjectLinearWorkItemsTabRenderer";

export default ProjectLinearWorkItemsTabRenderer;
