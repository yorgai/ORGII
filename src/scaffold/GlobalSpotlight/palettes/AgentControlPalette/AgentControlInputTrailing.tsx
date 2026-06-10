import React from "react";

import ModelSelectorPill from "@src/components/ModelSelectorPill";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";

import { AgentControlSubmitButton } from "./AgentControlSubmitButton";

export interface AgentControlInputTrailingProps {
  selection: LastModelSelection | null;
  selectModelLabel: string;
  modelSelectorActive: boolean;
  onOpenModelSelector: () => void;
  submitDisabled: boolean;
  onSubmit: () => void;
}

export const AgentControlInputTrailing: React.FC<
  AgentControlInputTrailingProps
> = ({
  selection,
  selectModelLabel,
  modelSelectorActive,
  onOpenModelSelector,
  submitDisabled,
  onSubmit,
}) => {
  return (
    <div className="flex items-center gap-2">
      <ModelSelectorPill
        selection={selection}
        defaultLabel={selectModelLabel}
        active={modelSelectorActive}
        className="h-[28px] max-w-[180px] shrink-0 text-[13px]"
        dataTestId="agent-control-model-pill"
        ariaLabel={selectModelLabel}
        onClick={onOpenModelSelector}
      />
      <AgentControlSubmitButton disabled={submitDisabled} onSubmit={onSubmit} />
    </div>
  );
};
