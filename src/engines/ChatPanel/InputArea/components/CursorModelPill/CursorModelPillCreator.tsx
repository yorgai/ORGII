/**
 * CursorModelPillCreator
 *
 * SessionCreator-flavored variant of {@link CursorModelPill}: same
 * dropdown UI, but no `sessionId` because the user hasn't created a
 * Cursor IDE session yet — they're about to. The picked model is
 * stashed in `cursorCreatorModelOverrideAtom` and read once by
 * `useSessionLaunch` when calling `cursor_bridge_new_composer`,
 * so the fresh composer is born with the user's chosen model.
 *
 * No `seedModel` lookup either: there's no composer to read from
 * `state.vscdb`, so the pill just shows "Model: default" until the
 * user opens the dropdown and explicitly picks one.
 */
import { useAtom } from "jotai";
import React, { memo } from "react";

import { cursorCreatorModelOverrideAtom } from "@src/store/session/cursorModelOverrideAtom";

import { usePillOverrideSync } from "../usePillOverrideSync";
import CursorModelPillView from "./CursorModelPillView";
import { useCursorModels } from "./useCursorModels";

interface CursorModelPillCreatorProps {
  dropdownPlacement?: "bottom" | "top";
}

const CursorModelPillCreator: React.FC<CursorModelPillCreatorProps> = memo(
  ({ dropdownPlacement = "bottom" }) => {
    // No composer id pre-launch — `useCursorModels(null)` skips the
    // seed lookup and only fetches the model list when the dropdown
    // opens.
    const cursorModels = useCursorModels(null);
    const [, setOverride] = useAtom(cursorCreatorModelOverrideAtom);

    // Mirror the draft pick into the launch-scope atom so
    // `useSessionLaunch.handleLaunch` can read it once and pass it as
    // `modelName` to `cursor_bridge_new_composer`. Cleared on unmount
    // so a back-button / panel-close leaves the next creator visit neutral.
    usePillOverrideSync(cursorModels.pickedModel, setOverride);

    const {
      effectiveModel,
      models,
      modelSource,
      loading,
      error,
      refresh,
      selectModel,
    } = cursorModels;

    return (
      <CursorModelPillView
        effectiveModel={effectiveModel}
        models={models}
        modelSource={modelSource}
        loading={loading}
        error={error}
        refresh={refresh}
        selectModel={selectModel}
        dropdownPlacement={dropdownPlacement}
      />
    );
  }
);

CursorModelPillCreator.displayName = "CursorModelPillCreator";

export default CursorModelPillCreator;
