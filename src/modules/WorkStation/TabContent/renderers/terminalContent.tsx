/**
 * Renderer wrapper for `terminal-content` tabs (read-only terminal
 * output viewer opened from a pill double-click).
 *
 * The editor host currently pipes `tab.data.content` through a read-only
 * `CodeViewerContent`. Phase 2 will perform that adaptation here once
 * `CodeViewerContent` becomes mountable without the file-manager bag.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const TerminalContentTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const terminalName = String(
      tab.data.terminalName ?? tab.title ?? "Terminal Output"
    );
    return (
      <HostCoupledPlaceholder
        tabType="terminal-content"
        title={terminalName}
        hostNote="CodeViewerContent still requires editor host context"
      />
    );
  }
);

TerminalContentTabRenderer.displayName = "TerminalContentTabRenderer";

export default TerminalContentTabRenderer;
