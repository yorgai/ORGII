/**
 * Renderer wrapper for `git-log` tabs (git error-log viewer).
 *
 * The editor host's `TabContentRenderer` synthesises a multi-line error
 * banner string from `tab.data.operation/errorMessage/commandOutput` and
 * pipes it into a read-only `CodeViewerContent`. Phase 2 will move that
 * synthesis here so the dispatcher owns the full adaptation.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const GitLogTabRenderer: React.FC<UnifiedTabContentProps> = memo(({ tab }) => {
  const operation = String(tab.data.operation ?? "");
  return (
    <HostCoupledPlaceholder
      tabType="git-log"
      title={operation ? `Git ${operation} log` : "Git log"}
      hostNote="Editor host wires CodeViewerContent for read-only display"
    />
  );
});

GitLogTabRenderer.displayName = "GitLogTabRenderer";

export default GitLogTabRenderer;
