/**
 * Renderer wrapper for the `settings` tab.
 *
 * `EditorSettings` accepts no props, so this wrapper is fully
 * self-contained — Phase 2 can wire it through unchanged.
 */
import React, { memo } from "react";

import EditorSettings from "@src/modules/WorkStation/Settings";

import type { UnifiedTabContentProps } from "../types";

const SettingsTabRenderer: React.FC<UnifiedTabContentProps> = memo(() => (
  <EditorSettings />
));

SettingsTabRenderer.displayName = "SettingsTabRenderer";

export default SettingsTabRenderer;
