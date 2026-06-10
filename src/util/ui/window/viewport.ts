/**
 * CSS zoom-aware viewport helpers.
 *
 * The app applies CSS `zoom` to `document.documentElement` for UI scaling.
 * Under CSS zoom:
 *   - `getBoundingClientRect()` returns values in the *zoomed* coordinate
 *     space (i.e. already scaled by the zoom factor).
 *   - `window.innerWidth / window.innerHeight` always returns the *physical*
 *     viewport size, ignoring zoom.
 *
 * Mixing the two coordinate systems causes portal overlays (tooltips, hover
 * cards, dropdowns) to be mispositioned at any zoom level other than 100%.
 *
 * Use `getViewportSize()` instead of `window.innerWidth/innerHeight` whenever
 * you need to clamp or position a `position: fixed` overlay that was anchored
 * using `getBoundingClientRect()`.
 */

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Returns the effective viewport dimensions in the same coordinate space as
 * `getBoundingClientRect()` — i.e. divided by the current CSS zoom factor.
 *
 * Falls back to the raw `window.inner*` values when zoom is not set or is 1.
 */
export function getViewportSize(): ViewportSize {
  const zoom = parseFloat(
    (document.documentElement as HTMLElement).style.zoom || "1"
  );
  const factor = zoom > 0 ? zoom : 1;
  return {
    width: window.innerWidth / factor,
    height: window.innerHeight / factor,
  };
}
