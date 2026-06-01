/**
 * Renderer wrapper for `ai-impact` tabs.
 *
 * `AIImpactContent` is fully self-contained — it loads provenance data
 * via Tauri commands and reads workspace atoms directly. No tab.data
 * adaptation needed.
 */
import React, { memo } from "react";

import AIImpactContent from "@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/AIImpactContent";

import type { UnifiedTabContentProps } from "../types";

const AIImpactTabRenderer: React.FC<UnifiedTabContentProps> = memo(() => (
  <AIImpactContent />
));

AIImpactTabRenderer.displayName = "AIImpactTabRenderer";

export default AIImpactTabRenderer;
