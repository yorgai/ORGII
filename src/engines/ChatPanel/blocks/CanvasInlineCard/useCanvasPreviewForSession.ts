import { useAtom } from "jotai";
import { useCallback } from "react";

import { canvasPreviewAtom } from "@src/store/session/canvasPreviewAtom";

import type { CanvasInlinePayload } from "./useCanvasInlineStream";

export function useCanvasPreviewForSession(
  sessionId: string | null | undefined
): {
  payload: CanvasInlinePayload | null;
  dismiss: () => void;
  clearCanvas: () => void;
} {
  const [entry, setEntry] = useAtom(canvasPreviewAtom);
  const payload =
    entry && entry.sessionId === sessionId && !entry.cardDismissed
      ? entry.payload
      : null;

  const dismiss = useCallback(() => {
    setEntry((prev) => (prev ? { ...prev, cardDismissed: true } : null));
  }, [setEntry]);

  const clearCanvas = useCallback(() => {
    setEntry(null);
  }, [setEntry]);

  return { payload, dismiss, clearCanvas };
}
