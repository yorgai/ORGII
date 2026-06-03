/**
 * CursorModePillCreator
 *
 * SessionCreator-flavored variant of {@link CursorModePill}: same
 * dropdown UI, but no `sessionId` because the user hasn't created a
 * Cursor IDE session yet. Picked mode is stashed in
 * `cursorCreatorModeOverrideAtom` and read once by `useSessionLaunch`
 * when calling `cursor_bridge_new_composer` so the fresh
 * composer is stamped with the right mode after creation.
 */
import { useAtom } from "jotai";
import React, { memo } from "react";

import { cursorCreatorModeOverrideAtom } from "@src/store/session/cursorModeOverrideAtom";

import { usePillOverrideSync } from "../usePillOverrideSync";
import CursorModePillView from "./CursorModePillView";
import { useCursorModes } from "./useCursorModes";

const CursorModePillCreator: React.FC = memo(() => {
  // No composer id pre-launch — `useCursorModes(null)` skips the
  // seed lookup. The pill defaults to showing "Agent" until the
  // user picks something else.
  const cursorModes = useCursorModes(null);
  const [, setOverride] = useAtom(cursorCreatorModeOverrideAtom);

  usePillOverrideSync(cursorModes.pickedMode, setOverride);

  const { effectiveMode, modes, modeSource, loading, refresh, selectMode } =
    cursorModes;

  return (
    <CursorModePillView
      effectiveMode={effectiveMode}
      modes={modes}
      modeSource={modeSource}
      loading={loading}
      refresh={refresh}
      selectMode={selectMode}
    />
  );
});

CursorModePillCreator.displayName = "CursorModePillCreator";

export default CursorModePillCreator;
