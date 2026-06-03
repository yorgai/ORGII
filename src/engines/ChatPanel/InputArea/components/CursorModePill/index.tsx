/**
 * CursorModePill (in-session)
 *
 * Cursor IDE-specific unified-mode pill shown in `InputArea` when the
 * focused session is a `cursoride-*` row. Sits next to the model pill
 * and gives the user the same Agent / Plan / Debug / Ask / Multitask /
 * Project switch they'd see inside Cursor's own picker.
 *
 * Same lifecycle as `CursorModelPill`: lazy list fetch on first
 * mount (cached app-wide), local `pickedMode` mirrored into a
 * session-scoped atom so the send pipeline can apply the mode
 * composer-targeted right before the prompt lands.
 */
import { useAtom } from "jotai";
import React, { memo } from "react";

import { cursorModeOverrideAtomFamily } from "@src/store/session/cursorModeOverrideAtom";
import { composerIdFromSessionId } from "@src/util/session/sessionDispatch";

import { usePillOverrideSync } from "../usePillOverrideSync";
import CursorModePillView from "./CursorModePillView";
import { useCursorModes } from "./useCursorModes";

interface CursorModePillProps {
  /** Cursor IDE session id (`cursoride-<composerId>`). */
  sessionId: string;
}

const CursorModePill: React.FC<CursorModePillProps> = memo(({ sessionId }) => {
  const composerId = composerIdFromSessionId(sessionId);
  const cursorModes = useCursorModes(composerId);

  const [, setOverride] = useAtom(cursorModeOverrideAtomFamily(sessionId));
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

CursorModePill.displayName = "CursorModePill";

export default CursorModePill;
