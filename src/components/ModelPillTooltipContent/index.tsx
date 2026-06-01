/**
 * ModelPillTooltipContent
 *
 * Framed tooltip body for model pills: spotlight-style account › model
 * breadcrumb on the left, keyboard shortcut chip on the right.
 */
import React, { memo } from "react";

import type { ModelType } from "@src/api/tauri/rpc/schemas/validation";
import {
  KEYBOARD_SHORTCUT_VARIANT,
  KeyboardShortcut,
} from "@src/components/KeyboardShortcut";
import ModelSelectionBreadcrumb from "@src/components/ModelSelectionBreadcrumb";

export interface ModelPillTooltipContentProps {
  accountName?: string;
  modelLabel: string;
  modelId?: string;
  modelType?: ModelType;
  shortcut: string;
}

export const ModelPillTooltipContent: React.FC<ModelPillTooltipContentProps> =
  memo(({ accountName, modelLabel, modelId, modelType, shortcut }) => (
    <div className="flex items-center gap-3 whitespace-nowrap">
      <ModelSelectionBreadcrumb
        accountName={accountName}
        modelLabel={modelLabel}
        modelId={modelId}
        modelType={modelType}
      />
      <KeyboardShortcut
        shortcut={shortcut}
        variant={KEYBOARD_SHORTCUT_VARIANT.dropdown}
      />
    </div>
  ));

ModelPillTooltipContent.displayName = "ModelPillTooltipContent";

export default ModelPillTooltipContent;
