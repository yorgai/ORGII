/**
 * VirtualizedStickyTree Configuration
 *
 * Default values matching VS Code's implementation.
 */

/** Default max sticky items (VS Code uses 7) */
export const DEFAULT_MAX_STICKY_ITEMS = 7;

/** Default max sticky height ratio (VS Code uses 0.4) */
export const DEFAULT_MAX_STICKY_HEIGHT_RATIO = 0.4;

/** Default overscan for Virtuoso */
export const DEFAULT_OVERSCAN = 50;

/** Default viewport buffer */
export const DEFAULT_VIEWPORT_BUFFER = { top: 400, bottom: 400 };

/**
 * Minimum number of descendants a node must have to become sticky.
 * Prevents shallow folders from flashing in/out of the sticky area.
 * A folder with fewer descendants than this will be skipped as a sticky candidate
 * (its parent stays sticky instead).
 */
export const MIN_STICKY_DESCENDANTS = 4;
