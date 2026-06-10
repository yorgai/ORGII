/**
 * Renderer wrapper for `dom-component-preview` tabs (paste-pill DOM JSON
 * with Raw / Preview toggle).
 *
 * Like `terminal-content`, real rendering happens inside the Code Editor
 * host (`EditorMainPane`/`TabContentRenderer`), so the unified registry
 * keeps a host-coupled placeholder here.
 */
import React, { memo } from "react";

import type { UnifiedTabContentProps } from "../types";
import { HostCoupledPlaceholder } from "./HostCoupledPlaceholder";

const DomComponentPreviewTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const fileName = String(tab.data.fileName ?? tab.title ?? "Pasted JSON");
    return (
      <HostCoupledPlaceholder
        tabType="dom-component-preview"
        title={fileName}
        hostNote="DomComponentPreviewContent still requires editor host context"
      />
    );
  }
);

DomComponentPreviewTabRenderer.displayName = "DomComponentPreviewTabRenderer";

export default DomComponentPreviewTabRenderer;
