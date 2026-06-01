/**
 * Renderer wrapper for `browser-session` tabs.
 *
 * The Browser host mounts the shared webview workspace once and
 * relies on internal session state (managed via `useBrowserLayoutState`)
 * to show/hide the right session. Single-pane mounting through the
 * unified registry would mean tearing down webviews on every tab
 * switch — Phase 2 will instead lift the webview host above the
 * dispatcher and let the wrapper drive `activeSessionId`.
 *
 * TODO(phase-2): expose `SharedBrowserWorkspace` activation through
 * the dispatcher context so a single registry mount can drive the
 * session without re-creating webviews.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const BrowserSessionTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <HostCoupledPlaceholder
      tabType={tab.type}
      title={String(tab.title ?? "Browser")}
      hostNote="Browser session still rendered by the Browser host (single shared webview workspace). Phase 2 will route activation through the dispatcher."
    />
  )
);

BrowserSessionTabRenderer.displayName = "BrowserSessionTabRenderer";

export default BrowserSessionTabRenderer;
