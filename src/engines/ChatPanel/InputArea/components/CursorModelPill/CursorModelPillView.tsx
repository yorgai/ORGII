/**
 * CursorModelPillView
 *
 * Presentational pill for the Cursor IDE model picker. Clicking the
 * pill opens the global Spotlight `CursorModelPalette` so the
 * picker UX matches every other model selector in the app.
 *
 * State (picked model, model list fetching) is managed by the
 * wrapper that mounts this view — both the in-session pill
 * (`./index.tsx`) and the SessionCreator pill
 * (`./CursorModelPillCreator.tsx`) feed it through `useCursorModels`
 * and a wrapper-specific override-storage hook (atom family vs.
 * single atom). Keeping the view dumb means the creator and the
 * focused-session paths can never diverge cosmetically.
 */
import { useAtomValue } from "jotai";
import { Grip } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  CursorModelEntry,
  CursorModelSource,
} from "@src/api/tauri/cursorBridge";
import { getIconSize } from "@src/components/CompoundPill/config";
import ModelIcon from "@src/components/ModelIcon";
import PillGroup, { type PillGroupSegment } from "@src/components/PillGroup";
import {
  CursorModelDropdown,
  CursorModelPalette,
} from "@src/scaffold/GlobalSpotlight/palettes";
import { modelPickerStyleAtom } from "@src/store/ui/chatPanelAtom";
import {
  compactModelLabel,
  formatModelNameFull,
} from "@src/util/formatModelName";

interface CursorModelPillViewProps {
  /** Picked → seed → null. The label / icon driver. */
  effectiveModel: string | null;
  models: CursorModelEntry[];
  modelSource: CursorModelSource;
  loading: boolean;
  error: string | null;
  /** Force a fresh `listModels()` round-trip. */
  refresh: () => Promise<void>;
  /** Stash the user's pick. */
  selectModel: (modelName: string) => void;
  /** Preferred dropdown placement for compact menu mode. */
  dropdownPlacement?: "bottom" | "top";
}

const CursorModelPillView: React.FC<CursorModelPillViewProps> = ({
  effectiveModel,
  models,
  modelSource,
  loading,
  error,
  refresh,
  selectModel,
  dropdownPlacement = "bottom",
}) => {
  const { t } = useTranslation("sessions");
  const iconSize = getIconSize();
  const modelPickerStyle = useAtomValue(modelPickerStyleAtom);
  const modelSegmentRef = useRef<HTMLButtonElement>(null);

  const [paletteOpen, setPaletteOpen] = useState(false);

  const handleOpenPalette = useCallback(() => {
    setPaletteOpen(true);
  }, []);

  const handleClosePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);

  // Resolve the displayed label. Priority: Cursor's human label
  // (`inputboxShortName` / `clientDisplayName`) → normalized
  // canonical id → an ellipsis while the seed loads. Normalization
  // runs through the same `formatModelNameFull` + `compactModelLabel`
  // pipeline as the regular ModelPill so the cosmetics match
  // ("Opus 4.5" instead of "claude-opus-4-6") even when the live
  // picker entry hasn't loaded yet.
  //
  // The "Default Model" placeholder this used to render is gone —
  // `useCursorModels` now seeds the pill with Cursor's *global*
  // default composer model (read from `state.vscdb`), so the pill
  // always shows the real model the next prompt will use. The "…"
  // is a momentary state that only shows during the `getDefaultModel`
  // fetch on cold start.
  const name = effectiveModel;
  const entry = name ? models.find((model) => model.name === name) : undefined;
  const displayLabel = !name
    ? "…"
    : (entry?.inputboxShortName ??
      entry?.clientDisplayName ??
      compactModelLabel(formatModelNameFull(name)));

  const switchTooltip = t("creator.switchModel", {
    defaultValue: "Switch model",
  });

  const segments: PillGroupSegment[] = [
    {
      id: "cursor-model",
      icon: effectiveModel ? (
        <ModelIcon modelName={effectiveModel} size={iconSize} />
      ) : (
        <Grip size={iconSize} strokeWidth={1.75} className="text-primary-6" />
      ),
      label: displayLabel,
      title:
        modelSource === "disk"
          ? t("chat.cursorControl.modelSourceDisk", {
              defaultValue:
                "Models loaded from disk cache (probe Cursor not yet running).",
            })
          : displayLabel,
      tooltip: switchTooltip,
      ariaLabel: switchTooltip,
      active: paletteOpen,
      danger: !effectiveModel,
      maxLabelWidth: 220,
      onClick: handleOpenPalette,
      buttonRef: modelSegmentRef,
    },
  ];

  return (
    <>
      <PillGroup
        segments={segments}
        className="text-[13px]"
        segmentClassName="h-[28px]"
        variant="input"
      />
      {modelPickerStyle === "dropdown" ? (
        <CursorModelDropdown
          isOpen={paletteOpen}
          onClose={handleClosePalette}
          models={models}
          modelSource={modelSource}
          effectiveModel={effectiveModel}
          loading={loading}
          error={error}
          refresh={refresh}
          onSelect={selectModel}
          anchorRef={modelSegmentRef}
          placement={dropdownPlacement}
        />
      ) : (
        <CursorModelPalette
          isOpen={paletteOpen}
          onClose={handleClosePalette}
          models={models}
          modelSource={modelSource}
          effectiveModel={effectiveModel}
          loading={loading}
          error={error}
          refresh={refresh}
          onSelect={selectModel}
        />
      )}
    </>
  );
};

export default CursorModelPillView;
