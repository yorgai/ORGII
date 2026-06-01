/**
 * Renderer wrapper for `workItem-detail` tabs.
 *
 * `WorkItemDetailPage` is mounted today inside
 * `ProjectManagerContentRouter` with `onCloseTab`, `onUpdateTabMeta`,
 * `onSetTabUnsaved`, and `onEmbeddedWorkItemDetailStateChange`.
 * Phase 1b cannot reach those callbacks without rewiring the router.
 *
 * TODO(phase-2): expose the work-item detail callbacks through the
 * dispatcher context so this surface can render standalone.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const WorkItemDetailTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Work Item")}
      hostNote="Work item detail still rendered by ProjectManagerContentRouter (needs tab close / meta / unsaved / state callbacks). Phase 2 will lift these through the dispatcher context."
    />
  )
);

WorkItemDetailTabRenderer.displayName = "WorkItemDetailTabRenderer";

export default WorkItemDetailTabRenderer;
