/**
 * Background Configuration Atoms
 *
 * Manages the app's wallpaper / background state:
 *   - Image (bundled presets + user uploads)
 *   - Solid color (preset pairs + custom hex)
 *   - Animation type
 *   - Liquid Glass thickness
 *   - Adaptive colors
 *
 * Persisted to localStorage under `orgii_background_config`.
 * One-time migration merges the old `orgii_custom_color` key into
 * `customColors` and removes the legacy key.
 */
import { atom } from "jotai";

import {
  getColorPairById,
  resolveColorPair,
} from "@src/config/appearance/backgroundColorPairs";
import {
  CUSTOM_COLOR_STORAGE_KEY,
  DEFAULT_BUNDLED_BACKGROUND_IMAGE,
  mergeStoredCustomColors,
} from "@src/config/appearance/backgroundConfig";

// ============================================
// Types
// ============================================

export interface BackgroundConfig {
  imageUrl: string;
  selectedImageId?: string;
  blurAmount?: number;
  customImages?: string[];
  adaptiveColors?: boolean;
  /** DIY solid hex colors (#rrggbb), shown after presets */
  customColors?: string[];
  /**
   * Resolved hex color currently applied. For preset pairs this mirrors the
   * theme-appropriate side of the pair so legacy consumers reading
   * `backgroundColor` keep working without resolving the pair themselves.
   * For a custom color pick this holds the user's exact hex.
   */
  backgroundColor?: string;
  /**
   * Stable ID of the active preset color pair (e.g. "classic", "ocean").
   * When set, `backgroundColor` is derived from this pair + the active
   * appearance mode by `resolvedBackgroundConfigAtom`. Absent for custom
   * colors and image backgrounds.
   */
  backgroundColorId?: string;
  animation?: string;
  matrixCharSet?: "binary" | "latin" | "symbols" | "katakana";
  /** Liquid Glass thickness level. Undefined = off. */
  liquidGlass?: "regular" | "medium" | "thick";
}

// ============================================
// Defaults + localStorage helpers
// ============================================

const BACKGROUND_CONFIG_KEY = "orgii_background_config";

const VALID_LIQUID_GLASS_LEVELS = new Set(["regular", "medium", "thick"]);

const DEFAULT_BACKGROUND_PAIR_ID = "graphite";
const DEFAULT_BACKGROUND_PAIR = getColorPairById(DEFAULT_BACKGROUND_PAIR_ID);

const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  imageUrl: DEFAULT_BUNDLED_BACKGROUND_IMAGE,
  blurAmount: 0,
  customImages: [],
  customColors: [],
  adaptiveColors: true,
  backgroundColorId: DEFAULT_BACKGROUND_PAIR_ID,
  backgroundColor: DEFAULT_BACKGROUND_PAIR
    ? resolveColorPair(DEFAULT_BACKGROUND_PAIR)
    : undefined,
};

function getStoredBackgroundConfig(): BackgroundConfig {
  try {
    const stored = localStorage.getItem(BACKGROUND_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      if (!VALID_LIQUID_GLASS_LEVELS.has(parsed.liquidGlass as string)) {
        parsed.liquidGlass =
          parsed.liquidGlass === true ? "regular" : undefined;
      }
      const merged = {
        ...DEFAULT_BACKGROUND_CONFIG,
        ...parsed,
      } as BackgroundConfig;

      const sanitizedAnimation =
        merged.animation === "retro-gameoflife" ? undefined : merged.animation;

      let legacyPickerHex: string | null = null;
      try {
        legacyPickerHex = localStorage.getItem(CUSTOM_COLOR_STORAGE_KEY);
      } catch {
        legacyPickerHex = null;
      }
      const customColors = mergeStoredCustomColors({
        parsedCustomColors: merged.customColors,
        backgroundColor: merged.backgroundColor,
        backgroundColorId: merged.backgroundColorId,
        legacyPickerHex,
      });
      try {
        localStorage.removeItem(CUSTOM_COLOR_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return { ...merged, animation: sanitizedAnimation, customColors };
    }
  } catch (err) {
    console.warn("[BackgroundConfig] Failed to parse stored config:", err);
  }
  return DEFAULT_BACKGROUND_CONFIG;
}

// ============================================
// Atoms
// ============================================

export const backgroundConfigAtom = atom<BackgroundConfig>(
  getStoredBackgroundConfig()
);
backgroundConfigAtom.debugLabel = "backgroundConfigAtom";

export const backgroundConfigPersistAtom = atom(
  (get) => get(backgroundConfigAtom),
  (get, set, value: BackgroundConfig) => {
    set(backgroundConfigAtom, value);
    localStorage.setItem(BACKGROUND_CONFIG_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event("backgroundConfigChange"));
  }
);

/**
 * Resolved background config: when a paired preset is active, swaps the
 * `backgroundColor` to the active public-theme CSS variable for that semantic
 * slot. Falls through to the raw config for custom colors and image
 * backgrounds.
 */
export const resolvedBackgroundConfigAtom = atom<BackgroundConfig>((get) => {
  const config = get(backgroundConfigAtom);
  const pairId = config.backgroundColorId;
  if (!pairId) return config;
  const pair = getColorPairById(pairId);
  if (!pair) return config;
  return {
    ...config,
    backgroundColor: resolveColorPair(pair),
  };
});
resolvedBackgroundConfigAtom.debugLabel = "resolvedBackgroundConfigAtom";

/**
 * Narrow selector for the active color-pair id. Components that only need to
 * react to preset *changes* (e.g. the glass-material prewarm effect) should
 * read this atom instead of the full config to avoid re-running on every
 * unrelated tweak (blur amount, animation speed, etc.).
 */
export const activeColorPairIdAtom = atom(
  (get) => get(backgroundConfigAtom).backgroundColorId
);
activeColorPairIdAtom.debugLabel = "activeColorPairIdAtom";

/** Legacy alias — kept for backward compatibility with old imports */
export const backgroundImageAtom = backgroundConfigAtom;
