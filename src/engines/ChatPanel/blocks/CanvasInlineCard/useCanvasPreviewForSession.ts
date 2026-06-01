/**
 * useCanvasPreviewForSession — reads the canvas payload for a given session
 * from `canvasPreviewAtom` (set by openInSimulatorCanvas when the agent fires
 * render_inline_canvas). Returns the payload when the stored session matches,
 * otherwise null.
 */
import { useAtom } from "jotai";
import { useCallback } from "react";

import { canvasPreviewAtom } from "@src/store/session/canvasPreviewAtom";

import type { CanvasInlinePayload } from "./useCanvasInlineStream";

export function useCanvasPreviewForSession(
  sessionId: string | null | undefined
): {
  payload: CanvasInlinePayload | null;
  dismiss: () => void;
} {
  const [entry, setEntry] = useAtom(canvasPreviewAtom);
  const payload = entry && entry.sessionId === sessionId ? entry.payload : null;

  const dismiss = useCallback(() => {
    setEntry(null);
  }, [setEntry]);

  return { payload, dismiss };
}
