/**
 * Shared pointer-hover open delay for simulator bottom chrome (dock, replay strip).
 * Avoids expanding UI when the cursor only passes through the hit area.
 */
export const SIMULATOR_POINTER_HOVER_OPEN_DEBOUNCE_MS = 60;

/**
 * Delay before collapsing auto-hide dock after pointer leaves the hit region.
 * Prevents open/close flicker when the cursor grazes the edge or layout shifts slightly.
 */
export const SIMULATOR_POINTER_HOVER_CLOSE_DELAY_MS = 200;
