import { useAtomValue, useSetAtom } from "jotai";
import { DraftingCompass } from "lucide-react";
import React, { useCallback } from "react";

import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
import { UnifiedModelPalette } from "@src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette";
import type { BasePaletteProps } from "@src/scaffold/GlobalSpotlight/shared";
import { modelSelectorAtom } from "@src/store/ui/modelSelectorAtom";

import { PaletteBody, SpotlightShell } from "../../shell";
import { AgentControlInputTrailing } from "./AgentControlInputTrailing";
import { AgentControlProposalCard } from "./AgentControlProposalCard";
import { AgentControlStatus } from "./AgentControlStatus";
import { AgentControlToolbar } from "./AgentControlToolbar";
import { useAgentControlPalette } from "./useAgentControlPalette";

export type { GuiControlSubmitDetail } from "./types";
export {
  GUI_CONTROL_SUBMIT_EVENT,
  GUI_CONTROL_TOGGLE_SHORTCUT_ID,
} from "./constants";

export interface AgentControlPaletteProps extends BasePaletteProps {
  asBody?: boolean;
}

export const AgentControlPalette: React.FC<AgentControlPaletteProps> = ({
  isOpen,
  onClose,
  asBody = false,
}) => {
  const selectorState = useAtomValue(modelSelectorAtom);
  const setSelectorState = useSetAtom(modelSelectorAtom);
  const isModelOpen = selectorState.isOpen;
  const palette = useAgentControlPalette({ isOpen, onClose });

  const handleOpenModelSelector = useCallback(() => {
    setSelectorState({ isOpen: true });
  }, [setSelectorState]);

  const inputTrailingSlot = (
    <AgentControlInputTrailing
      selection={palette.creatorDefaultLastModel}
      selectModelLabel={palette.selectModelLabel}
      modelSelectorActive={isModelOpen}
      onOpenModelSelector={handleOpenModelSelector}
      submitDisabled={palette.submitDisabled}
      onSubmit={palette.handleSubmit}
    />
  );

  const body = (
    <>
      <PaletteBody
        kernel={palette.kernel}
        items={palette.items}
        path={palette.modePath}
        placeholder={palette.placeholder}
        inputTrailingSlot={inputTrailingSlot}
        contentOverride={null}
        inputIcon={DraftingCompass}
      />
      {palette.showStatusLine && (
        <AgentControlStatus
          icon={palette.statusIcon}
          label={palette.statusLabel}
          detail={palette.statusDetail}
          spinning={palette.statusSpinning}
          isMarkdown={palette.statusIsMarkdown}
        />
      )}
      {palette.pendingProposal && (
        <AgentControlProposalCard
          proposal={palette.pendingProposal}
          onDismiss={palette.handleDismissProposal}
        />
      )}
      {palette.showSessionControls && (
        <AgentControlToolbar
          onNewRound={palette.handleRefreshSession}
          onPreviousActivity={palette.handlePreviousActivity}
          onNextActivity={palette.handleNextActivity}
          onLatestActivity={palette.handleLatestActivity}
          hasPreviousActivity={palette.hasPreviousActivity}
          hasNextActivity={palette.hasNextActivity}
          previousIcon={palette.toolbarActions.previousIcon}
          nextIcon={palette.toolbarActions.nextIcon}
          latestIcon={palette.toolbarActions.latestIcon}
        />
      )}
    </>
  );

  return (
    <>
      {asBody ? (
        body
      ) : (
        <SpotlightShell isOpen={isOpen} onClose={onClose} hideFooter>
          {body}
        </SpotlightShell>
      )}
      <UnifiedModelPalette
        isOpen={isModelOpen}
        onClose={palette.handleCloseModelSelector}
        advancedConfig={palette.creatorDefaultLastModel ?? {}}
        onConfigChange={palette.handleModelConfigChange}
        dispatchCategoryOverride={DISPATCH_CATEGORY.RUST_AGENT}
      />
    </>
  );
};

export default AgentControlPalette;
