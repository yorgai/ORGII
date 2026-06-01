/**
 * ModelSelectionBreadcrumb
 *
 * Spotlight-style account › model breadcrumb used in model palette rows
 * and model-pill hover tooltips.
 */
import React, { memo } from "react";

import type { ModelType } from "@src/api/tauri/rpc/schemas/validation";
import ModelIcon from "@src/components/ModelIcon";

export interface ModelSelectionBreadcrumbProps {
  /** Key vault account name or hosted listing label */
  accountName?: string;
  /** Resolved model display label (alias or formatted id) */
  modelLabel: string;
  /** Wire model id for the model icon */
  modelId?: string;
  /** Provider / agent type for the account icon when model id is absent */
  modelType?: ModelType;
  className?: string;
}

export const ModelSelectionBreadcrumb: React.FC<ModelSelectionBreadcrumbProps> =
  memo(({ accountName, modelLabel, modelId, modelType, className = "" }) => (
    <span
      className={`inline-flex min-w-0 max-w-[320px] items-center gap-1.5 text-[13px] ${className}`}
    >
      {accountName ? (
        <>
          <span className="shrink-0 text-text-2">{accountName}</span>
          <span className="mx-1 shrink-0 text-text-3">›</span>
        </>
      ) : null}
      {modelId || modelType ? (
        <ModelIcon
          modelName={modelId}
          agentType={modelType}
          size={14}
          className="shrink-0"
        />
      ) : null}
      <span className="min-w-0 truncate font-semibold text-text-1">
        {modelLabel}
      </span>
    </span>
  ));

ModelSelectionBreadcrumb.displayName = "ModelSelectionBreadcrumb";

export default ModelSelectionBreadcrumb;
