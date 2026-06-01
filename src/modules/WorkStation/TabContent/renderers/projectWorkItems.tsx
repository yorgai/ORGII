/**
 * Renderer wrapper for `project-work-items` tabs.
 *
 * Project work items tab uses the keep-alive cache and several host
 * callbacks (`onExpandWorkItemToTab`, `onOpenChatSession`, tab data
 * mutators). Phase 1b cannot reach those without rewriting the
 * router; we render a placeholder for now.
 *
 * TODO(phase-2): expose the project-manager tab mutators through
 * the dispatcher context and move the keep-alive cache inside this
 * wrapper.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ProjectWorkItemsTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Work Items")}
      hostNote="Project work items still rendered by ProjectManagerContentRouter (keep-alive cache + tab mutators). Phase 2 will lift these through the dispatcher context."
    />
  )
);

ProjectWorkItemsTabRenderer.displayName = "ProjectWorkItemsTabRenderer";

export default ProjectWorkItemsTabRenderer;
