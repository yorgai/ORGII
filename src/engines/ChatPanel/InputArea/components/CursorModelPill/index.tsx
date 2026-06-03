/**
 * CursorModelPill (in-session)
 *
 * Cursor IDE-specific model pill shown in `InputArea` when the focused
 * session is a `cursoride-*` row. Replaces the regular {@link ModelPill}
 * because Cursor's available models are a *separate* universe from
 * ORGII's provider/listing model space — they're whatever the user's
 * Cursor entitlement currently allows, fetched live from the probe via
 * CDP (or read from disk while the probe is starting).
 *
 * Differences from `ModelPill`:
 *  - No source segment. Cursor IDE chats only have one "source" — the
 *    probe Cursor — so the second pill would be redundant.
 *  - Picks are local to the draft. Selection is *not* fired into Cursor
 *    on click; we let `cursorIdeAdapter.sendMessage` apply the model
 *    composer-targeted right before submitting the prompt. That way
 *    flipping through models doesn't churn through CDP eval round-trips.
 *  - Lazy model list. `listModels()` only fires the first time the
 *    dropdown is opened — at rest we just show whatever the composer
 *    last used (read from `state.vscdb` once on mount).
 *
 * The pill writes the user's pick into a session-scoped atom so
 * `InputArea`'s send handler can pull it out at submit time and pass
 * it as the `model` override to `SessionService.sendMessage`.
 */
import { useAtom } from "jotai";
import React, { memo } from "react";

import { cursorModelOverrideAtomFamily } from "@src/store/session/cursorModelOverrideAtom";
import { composerIdFromSessionId } from "@src/util/session/sessionDispatch";

import { usePillOverrideSync } from "../usePillOverrideSync";
import CursorModelPillView from "./CursorModelPillView";
import { useCursorModels } from "./useCursorModels";

interface CursorModelPillProps {
  /** Cursor IDE session id (`cursoride-<composerId>`). */
  sessionId: string;
}

const CursorModelPill: React.FC<CursorModelPillProps> = memo(
  ({ sessionId }) => {
    const composerId = composerIdFromSessionId(sessionId);
    const cursorModels = useCursorModels(composerId);

    // Mirror the picked model into a session-scoped atom so
    // `InputArea`'s send pipeline can read it at submit time without
    // having to reach back into this component. Cleared on unmount so
    // stale picks from a closed pill don't bleed into the next session.
    const [, setOverride] = useAtom(cursorModelOverrideAtomFamily(sessionId));
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
        dropdownPlacement="top"
      />
    );
  }
);

CursorModelPill.displayName = "CursorModelPill";

export default CursorModelPill;
