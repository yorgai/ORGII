/**
 * Canvas Preview Tab Factory
 *
 * Opens a canvas-preview tab in WorkStation that renders the agent's
 * `canvasPreviewAtom` payload. Keyed by sessionId so each session gets at
 * most one canvas tab open at a time.
 */
import { defineTabFactory } from "../tabFactory";
import type { WorkStationTab } from "../types";

export const CANVAS_PREVIEW_TAB_ID_PREFIX = "canvas-preview";

export interface CanvasPreviewTabData {
  /** Session that produced the canvas payload. */
  sessionId: string;
}

export const canvasPreviewTabFactory = defineTabFactory<CanvasPreviewTabData>({
  tabType: "canvas-preview",
  idStrategy: {
    type: "keyed",
    prefix: CANVAS_PREVIEW_TAB_ID_PREFIX,
    getKey: (data) => data.sessionId,
  },
  getTitle: () => "Canvas",
  icon: "Layout",
});

export function createCanvasPreviewTab(sessionId: string): WorkStationTab {
  return canvasPreviewTabFactory({ sessionId });
}

/** Stable tab ID for a given session — used to check if the tab is open. */
export function getCanvasPreviewTabId(sessionId: string): string {
  return `${CANVAS_PREVIEW_TAB_ID_PREFIX}:${sessionId}`;
}
