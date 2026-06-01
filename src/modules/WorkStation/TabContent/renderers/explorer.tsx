/**
 * Renderer wrapper for `explorer` tabs.
 *
 * `explorer` is currently a marker tab type that the Code Editor host
 * treats as the default / empty state. There is no concrete component
 * to render — the host paints the explorer sidebar and the main pane
 * shows an empty placeholder. Phase 1b mirrors that semantics so the
 * registry remains exhaustive without inventing a new surface.
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/modules/shared/layouts/blocks";

import type { UnifiedTabContentProps } from "../types";

const ExplorerTabRenderer: React.FC<UnifiedTabContentProps> = memo(() => {
  const { t } = useTranslation();
  return (
    <Placeholder
      variant="empty"
      placement="detail-panel"
      title={t("placeholders.explorerTabTitle", { defaultValue: "Explorer" })}
      fillParentHeight
    />
  );
});

ExplorerTabRenderer.displayName = "ExplorerTabRenderer";

export default ExplorerTabRenderer;
