/**
 * Background Configuration Atoms
 *
 * Manages the app's wallpaper / background state:
 *   - Image (bundled presets + user uploads)
 *   - Solid color (preset pairs + custom hex)
 *   - Animation type
 *   - Glass thickness
 *   - Adaptive colors
 *
 * Persisted to localStorage under `orgii_background_config`.
 */
import { atom } from "jotai";

import {
  getColorPairById,
  resolveColorPair,
} from "@src/config/appearance/backgroundColorPairs";
import {
  DEFAULT_BUNDLED_BACKGROUND_IMAGE,
  sanitizeCustomColorsArray,
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
   * Applied CSS color. For preset pairs this is a theme-aware desktop
   * background token (`var(--desktop-bg-*)`); for custom colors this is the
   * user's exact hex value.
   */
  backgroundColor?: string;
  /**
   * Stable ID of the active preset desktop background pair (e.g. "classic",
   * "ocean"). When set, `resolvedBackgroundConfigAtom` derives
   * `backgroundColor` from the active pair token. Absent for custom colors and
   * image backgrounds.
   */
  backgroundColorId?: string;
  animation?: string;
  matrixCharSet?: "binary" | "latin" | "symbols" | "katakana";
  /** Glass thickness level. Undefined = off. */
  glass?: "regular" | "medium" | "thick";
}

// ============================================
// Defaults + localStorage helpers
// ============================================

const BACKGROUND_CONFIG_KEY = "orgii_background_config";

const VALID_GLASS_LEVELS = new Set(["regular", "medium", "thick"]);

const DEFAULT_BACKGROUND_PAIR_ID = "graphite";

const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  imageUrl: DEFAULT_BUNDLED_BACKGROUND_IMAGE,
  blurAmount: 0,
  customImages: [],
  customColors: [],
  adaptiveColors: true,
  backgroundColorId: DEFAULT_BACKGROUND_PAIR_ID,
};

function getStoredBackgroundConfig(): BackgroundConfig {
  try {
    const stored = localStorage.getItem(BACKGROUND_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      if (!VALID_GLASS_LEVELS.has(parsed.glass as string)) {
        parsed.glass = undefined;
      }
      const merged = {
        ...DEFAULT_BACKGROUND_CONFIG,
        ...parsed,
      } as BackgroundConfig;
      return {
        ...merged,
        customColors: sanitizeCustomColorsArray(merged.customColors),
      };
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
