/**
 * Renderer wrapper for `component-preview` tabs.
 *
 * `ComponentPreviewPanel` needs `preview`, `details`, `projectFile`,
 * extraction flags and `onRefresh` callbacks today owned by
 * `useBrowserLayoutState`. None of those leak out of the Browser host
 * yet, so Phase 1b renders a placeholder.
 *
 * TODO(phase-2): expose preview state + extraction callbacks through
 * the dispatcher context so component-preview can mount standalone.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const ComponentPreviewTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Component Preview")}
      hostNote="Component preview still rendered by the Browser host (needs preview state + extraction callbacks). Phase 2 will lift these through the dispatcher context."
    />
  )
);

ComponentPreviewTabRenderer.displayName = "ComponentPreviewTabRenderer";

export default ComponentPreviewTabRenderer;
