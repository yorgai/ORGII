/**
 * openInSimulatorCanvas — Show a canvas payload in the WorkStation Build panel.
 *
 * Sets canvasPreviewAtom so SimulatorMessages renders the preview inline
 * without crossing any window / iframe boundary. The atom is read by
 * SimulatorMessages and drives a CanvasInlineCard overlay above the message
 * list.
 */
import { canvasPreviewAtom } from "@src/store/session/canvasPreviewAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import type { CanvasInlinePayload } from "./useCanvasInlineStream";

export function openInSimulatorCanvas(
  sessionId: string,
  payload: CanvasInlinePayload
): void {
  const store = getInstrumentedStore();
  store.set(canvasPreviewAtom, { sessionId, payload });
}
