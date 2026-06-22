/**
 * nativeFrame
 *
 * Converts a DOMRect to native window coordinates for Tauri IPC.
 *
 * The app shell uses native WebView zoom for the main UI. DOMRect values are
 * CSS-pixel measurements, while native child WebViews are positioned in the
 * parent window's logical coordinate space, so inline WebView frames apply the
 * dedicated `--native-frame-scale` compensation factor.
 */

export interface NativeFrame {
  x: number;
  y: number;
  a: number;
  b: number;
  width: number;
  height: number;
}

export interface NativeFrameCorners {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function getNativeFrameScale(): number {
  if (typeof document === "undefined") return 1;

  const rawScale = getComputedStyle(document.documentElement)
    .getPropertyValue("--native-frame-scale")
    .trim();
  const scale = Number.parseFloat(rawScale);

  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return scale;
}

export function resolveNativeFrameScale(
  devicePixelRatio: number,
  windowScaleFactor: number,
  fallbackScale = 1
): number {
  const measuredScale = devicePixelRatio / windowScaleFactor;
  if (Number.isFinite(measuredScale) && measuredScale > 0) {
    return measuredScale;
  }

  if (Number.isFinite(fallbackScale) && fallbackScale > 0) {
    return fallbackScale;
  }

  return 1;
}

export function toNativeFrameFromCorners(
  corners: NativeFrameCorners,
  scale = 1
): NativeFrame {
  const left = Math.round(corners.left * scale);
  const top = Math.round(corners.top * scale);
  const right = Math.round(corners.right * scale);
  const bottom = Math.round(corners.bottom * scale);

  return {
    x: left,
    y: top,
    a: right,
    b: bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * Converts a CSS-layout DOMRect (optionally with a uniform inset) to native
 * window coordinates suitable for Tauri `invoke` payloads.
 *
 * The frame is derived from start/end corners first, then converted to
 * x/y/a/b/width/height. This avoids width/height rounding drift between the
 * React overlay and native child WebView.
 *
 * @param rect  - Value from `element.getBoundingClientRect()`
 * @param inset - Uniform pixel inset to apply before scaling (default 0)
 */
export function toNativeFrame(rect: DOMRect, inset = 0): NativeFrame {
  return toNativeFrameFromCorners(
    {
      left: rect.left + inset,
      top: rect.top + inset,
      right: rect.right - inset,
      bottom: rect.bottom - inset,
    },
    getNativeFrameScale()
  );
}
