/**
 * Shared types for the ContextInfoButton sub-component tree.
 */

export type RingTone = "neutral" | "warning" | "danger";

export interface PanelCategory {
  key: string;
  labelKey: string;
  tokens: number;
  hex: string;
}

export interface PanelPosition {
  bottom: number;
  right: number;
}

// Ring geometry constants — used by both ProgressRing and useContextPanel.
export const RING_SIZE = 14;
export const RING_STROKE = 1.75;
export const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Panel positioning constants.
export const PANEL_GAP = 8;
export const PANEL_WIDTH = 320;
export const VIEWPORT_PADDING = 8;

// Context-fill thresholds for visual warnings.
export const WARNING_THRESHOLD = 80;
export const DANGER_THRESHOLD = 95;
