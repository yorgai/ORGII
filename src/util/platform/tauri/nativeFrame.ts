/**
 * nativeFrame
 *
 * Converts a CSS-pixel DOMRect to native window coordinates for Tauri IPC.
 *
 * CSS `zoom` on `<html>` shifts all layout APIs (getBoundingClientRect,
 * offsetLeft, clientWidth, …) into a zoom-adjusted CSS-pixel space. Wry
 * positions child WebViews in the *unzoomed* native window coordinate space,
 * so every rect that crosses the Tauri boundary must be re-expanded by the
 * current UI scale factor.
 */

/**
 * Reads the current UI scale factor from the CSS custom property `--ui-scale`
 * set by `useAppShellEffects`. Returns 1 if the property is absent or invalid.
 */
export function getUiScale(): number {
  if (typeof document === "undefined") return 1;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--ui-scale")
    .trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export interface NativeFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts a CSS-layout DOMRect (optionally with a uniform inset) to native
 * window pixel coordinates suitable for Tauri `invoke` payloads.
 *
 * @param rect  - Value from `element.getBoundingClientRect()`
 * @param inset - Uniform pixel inset to apply before scaling (default 0)
 */
export function toNativeFrame(rect: DOMRect, inset = 0): NativeFrame {
  const scale = getUiScale();
  return {
    x: Math.round((rect.left + inset) * scale),
    y: Math.round((rect.top + inset) * scale),
    width: Math.round((rect.width - inset * 2) * scale),
    height: Math.round((rect.height - inset * 2) * scale),
  };
}
