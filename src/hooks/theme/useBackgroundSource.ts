/**
 * useBackgroundSource Hook
 *
 * Composes the resolved background config and the image URL into a single
 * BackgroundSource discriminated union. This is the canonical input for any
 * consumer (today: LiquidGlassToolbar via useLiquidGlassRenderer) that needs
 * to know what the current toolbar/window background is.
 *
 * Reads `resolvedBackgroundConfigAtom` so a theme flip swaps the active side
 * of a color pair (e.g. classic.light <-> classic.dark) and the WebGL
 * renderer resamples just like it does on a wallpaper change.
 *
 * Precedence:
 *   1. Liquid Glass active   -> { kind: "none" } (native NSGlassEffectView covers it)
 *   2. Solid color selected  -> { kind: "color", value }
 *   3. Image URL resolved    -> { kind: "image", url }
 *   4. Nothing               -> { kind: "none" }
 */
import { useAtomValue } from "jotai";
import { useMemo } from "react";

import {
  type BackgroundSource,
  NONE_SOURCE,
} from "@src/components/LiquidGlass/Toolbar/backgroundSource";
import { resolvedBackgroundConfigAtom } from "@src/store";

import { useBackgroundImage } from "./useBackgroundImage";

export function useBackgroundSource(): BackgroundSource {
  const config = useAtomValue(resolvedBackgroundConfigAtom);
  const imageUrl = useBackgroundImage();

  return useMemo<BackgroundSource>(() => {
    if (config.liquidGlass != null) return NONE_SOURCE;
    if (config.backgroundColor) {
      return { kind: "color", value: config.backgroundColor };
    }
    if (imageUrl) return { kind: "image", url: imageUrl };
    return NONE_SOURCE;
  }, [config.liquidGlass, config.backgroundColor, imageUrl]);
}

export default useBackgroundSource;
