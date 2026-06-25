/**
 * ChatPanel Configuration Constants
 */

// CSS variable for chat width
export const CHAT_WIDTH_CSS_VAR = "--orgii-chat-width";

// Resize constraints
export const MIN_WIDTH = 420;
export const MAX_WIDTH = 800;
export const MIN_CENTER_WIDTH = 400; // Minimum width for center content area
export const LEFT_PANEL_WIDTH = 64; // Navigation sidebar width
export const CHAT_PANEL_VIEWPORT_MARGIN = 20;

export const getMaxWidthForContainer = (containerWidth: number): number =>
  Math.max(
    MIN_WIDTH,
    containerWidth - MIN_CENTER_WIDTH - CHAT_PANEL_VIEWPORT_MARGIN
  );

export const getCurrentMaxWidth = (): number =>
  typeof window === "undefined"
    ? MAX_WIDTH
    : getMaxWidthForContainer(window.innerWidth - LEFT_PANEL_WIDTH);

export const clampWidthForViewport = (width: number): number => {
  if (width <= 0) return width;
  return Math.min(Math.max(width, MIN_WIDTH), getCurrentMaxWidth());
};

export const clampWidthForContainer = (
  width: number,
  containerWidth: number
): number => {
  if (width <= 0) return width;
  return Math.min(
    Math.max(width, MIN_WIDTH),
    getMaxWidthForContainer(containerWidth)
  );
};

// Timing constants
export const RAPID_CLICK_THRESHOLD_MS = 300;
