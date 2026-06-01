/**
 * ControlButtons Component
 *
 * Control buttons for SessionCreator:
 * - Model selector pill (model name only)
 * - Agent execution mode pill for Rust and CLI sessions
 */
import { useAtom, useAtomValue } from "jotai";
import { Grip } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { PILL_SM_ICON_SIZE } from "@src/components/CompoundPill/config";
import ModelIcon from "@src/components/ModelIcon";
import ModelPillTooltipContent from "@src/components/ModelPillTooltipContent";
import SelectorPill from "@src/components/SelectorPill";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import CursorModePillCreator from "@src/engines/ChatPanel/InputArea/components/CursorModePill/CursorModePillCreator";
import CursorModelPillCreator from "@src/engines/ChatPanel/InputArea/components/CursorModelPill/CursorModelPillCreator";
import ModePill from "@src/engines/ChatPanel/InputArea/components/ModePill";
import type { AgentExecMode } from "@src/features/SessionCreator/config";
import { useModelPillLabel } from "@src/hooks/models";
import {
  UnifiedModelDropdown,
  UnifiedModelPalette,
} from "@src/scaffold/GlobalSpotlight/palettes";
import { dispatchCategoryAtom } from "@src/store/session/creatorStateAtom";
import { modelPickerStyleAtom } from "@src/store/ui/chatPanelAtom";
import { modelSelectorAtom } from "@src/store/ui/modelSelectorAtom";

import type { ControlButtonsProps } from "./types";

export type { ControlButtonsProps, DropdownDirection } from "./types";

const ControlButtons: React.FC<ControlButtonsProps> = memo(
  ({
    advancedConfig,
    onConfigChange,
    dropdownDirection = "down",
    requestModelOpen,
    onModelOpenHandled,
    hideModelSourcePill,
    hideModePill,
  }) => {
    const { t: tSessions } = useTranslation("sessions");

    const dispatchCategory = useAtomValue(dispatchCategoryAtom);
    const usesOrgiiExecMode =
      dispatchCategory === "rust_agent" || dispatchCategory === "cli_agent";
    const isCursorIdeMode = dispatchCategory === "cursor_ide";

    const [selectorState, setSelectorState] = useAtom(modelSelectorAtom);
    const isModelOpen = selectorState.isOpen;
    const modelPickerStyle = useAtomValue(modelPickerStyleAtom);
    const modelSegmentRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
      if (!requestModelOpen) return;
      const frameId = requestAnimationFrame(() => {
        setSelectorState({ isOpen: true });
        onModelOpenHandled?.();
      });
      return () => cancelAnimationFrame(frameId);
    }, [requestModelOpen, onModelOpenHandled, setSelectorState]);

    const iconSize = PILL_SM_ICON_SIZE;

    const defaultModelLabel = tSessions("creator.model");
    const {
      label: modelLabel,
      title: modelTitle,
      accountName,
    } = useModelPillLabel(advancedConfig, defaultModelLabel);

    const modelIconName = useMemo(
      () => advancedConfig.listingModel || advancedConfig.model || undefined,
      [advancedConfig.listingModel, advancedConfig.model]
    );
    const modelIconAgent = useMemo(
      () =>
        advancedConfig.listingModelType ??
        advancedConfig.selectedSourceModelType,
      [advancedConfig.listingModelType, advancedConfig.selectedSourceModelType]
    );
    const hasModelSelection = Boolean(modelIconName);

    const handleOpenModelSelector = useCallback(() => {
      setSelectorState({ isOpen: true });
    }, [setSelectorState]);

    const handleCloseSelector = useCallback(() => {
      setSelectorState({ isOpen: false });
    }, [setSelectorState]);

    const handleSdeModeChange = useCallback(
      (_mode: AgentExecMode) => {
        onConfigChange({ ...advancedConfig });
      },
      [advancedConfig, onConfigChange]
    );

    return (
      <div className="flex min-w-0 items-center gap-0">
        {!hideModePill && usesOrgiiExecMode && (
          <ModePill
            forceVisible
            onModeChange={handleSdeModeChange}
            placement={dropdownDirection === "up" ? "top" : "bottom"}
          />
        )}

        {!hideModePill && isCursorIdeMode && <CursorModePillCreator />}

        {!hideModelSourcePill && isCursorIdeMode && (
          <CursorModelPillCreator
            dropdownPlacement={dropdownDirection === "up" ? "top" : "bottom"}
          />
        )}

        {!hideModelSourcePill && !isCursorIdeMode && (
          <>
            <SelectorPill
              ref={modelSegmentRef}
              icon={
                hasModelSelection ? (
                  <ModelIcon
                    modelName={modelIconName}
                    agentType={modelIconAgent}
                    size={iconSize}
                  />
                ) : (
                  <Grip
                    size={iconSize}
                    strokeWidth={1.75}
                    className="text-warning-6"
                  />
                )
              }
              label={modelLabel}
              title={modelTitle}
              tooltip={
                <ModelPillTooltipContent
                  accountName={accountName}
                  modelLabel={modelTitle}
                  modelId={modelIconName}
                  modelType={
                    modelIconAgent ?? advancedConfig.selectedSourceModelType
                  }
                  shortcut={getShortcutKeys("open_model_selector")}
                />
              }
              tooltipFramed
              active={isModelOpen}
              danger={!hasModelSelection}
              className="max-w-[220px] shrink-0"
              onClick={handleOpenModelSelector}
              dataTestId="session-creator-input-model-pill"
              ariaLabel={tSessions("creator.selectModel")}
            />

            {isModelOpen &&
              (modelPickerStyle === "dropdown" ? (
                <UnifiedModelDropdown
                  isOpen={isModelOpen}
                  onClose={handleCloseSelector}
                  advancedConfig={advancedConfig}
                  onConfigChange={onConfigChange}
                  anchorRef={modelSegmentRef}
                  placement={dropdownDirection === "up" ? "top" : "bottom"}
                />
              ) : (
                <UnifiedModelPalette
                  isOpen={isModelOpen}
                  onClose={handleCloseSelector}
                  advancedConfig={advancedConfig}
                  onConfigChange={onConfigChange}
                />
              ))}
          </>
        )}
      </div>
    );
  }
);

ControlButtons.displayName = "ControlButtons";

export default ControlButtons;
