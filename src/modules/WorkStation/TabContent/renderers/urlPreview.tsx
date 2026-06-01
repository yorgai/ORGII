/**
 * Renderer wrapper for `url-preview` tabs.
 *
 * `UrlPreviewContent` accepts only `url` + optional `title` — both live
 * on `tab.data`. Fully self-contained.
 */
import React, { memo } from "react";

import UrlPreviewContent from "@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/UrlPreviewContent";

import type { UnifiedTabContentProps } from "../types";

const UrlPreviewTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const url = String(tab.data.url ?? "");
    const title = tab.data.title ? String(tab.data.title) : undefined;
    return <UrlPreviewContent url={url} title={title} />;
  }
);

UrlPreviewTabRenderer.displayName = "UrlPreviewTabRenderer";

export default UrlPreviewTabRenderer;
