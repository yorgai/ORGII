/**
 * useJumpToSimulatorCanvas — navigate the Simulator to the Canvas view.
 *
 * Calls `openInSimulatorCanvas` to store the payload in `canvasPreviewAtom`,
 * then sets `simulatorSelectedAppAtom` to `AppType.CANVAS` so the simulator
 * dock switches to the canvas app.
 */
import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { AppType } from "@src/engines/Simulator/types/appTypes";
import { simulatorSelectedAppAtom } from "@src/store/ui/simulatorAtom";

import { openInSimulatorCanvas } from "./openInSimulatorCanvas";
import type { CanvasInlinePayload } from "./useCanvasInlineStream";

export function useJumpToSimulatorCanvas(
  sessionId: string | null | undefined,
  payload: CanvasInlinePayload | null | undefined
): (() => void) | null {
  const setSelectedApp = useSetAtom(simulatorSelectedAppAtom);

  const jump = useCallback(() => {
    if (!sessionId || !payload) return;
    openInSimulatorCanvas(sessionId, payload);
    setSelectedApp(AppType.CANVAS);
  }, [sessionId, payload, setSelectedApp]);

  if (!sessionId || !payload) return null;
  return jump;
}
