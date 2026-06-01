/**
 * Renderer wrapper for `source-control` tabs (unified Focus / All Changes).
 *
 * TODO(Phase 2): `SourceControlMainContent` needs the editor host's
 * gitFilesByPath, sourceControlCollapseAllSignal, sourceControlFilterMode,
 * editorQuickActions, forceRefresh, plus the review-navigation atom and
 * the focus-path resolution that today lives inside the editor's
 * `TabContentRenderer`.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const SourceControlTabRenderer: React.FC<UnifiedTabContentProps> = memo(() => (
  <HostCoupledPlaceholder
    tabType="source-control"
    title="Source Control"
    hostNote="Editor host owns gitFilesByPath + Source Control header signals"
  />
));

SourceControlTabRenderer.displayName = "SourceControlTabRenderer";

export default SourceControlTabRenderer;
