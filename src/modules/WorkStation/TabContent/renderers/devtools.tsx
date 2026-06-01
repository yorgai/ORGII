/**
 * Renderer wrapper for `devtools` tabs.
 *
 * DevTools is rendered today inside the Browser host's
 * `SharedBrowserDevToolsPanel`, which depends on `useBrowserLayoutState`
 * (selected element, console/network entries, webview label, etc.).
 * None of that state is reachable outside the Browser host yet, so
 * Phase 1b renders a placeholder.
 *
 * TODO(phase-2): publish the devtools state subset through the
 * dispatcher context so this tab can render via the registry.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const DevtoolsTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "DevTools")}
      hostNote="DevTools panel still rendered by the Browser host (depends on shared webview state). Phase 2 will publish the devtools state subset through the dispatcher context."
    />
  )
);

DevtoolsTabRenderer.displayName = "DevtoolsTabRenderer";

export default DevtoolsTabRenderer;
