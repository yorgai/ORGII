/**
 * Background Configuration Atoms
 *
 * Manages the app's wallpaper / background state:
 *   - Image (bundled presets + user uploads)
 *   - Solid color (preset IDs + custom hex)
 *   - Animation type
 *   - Glass thickness
 *   - Adaptive colors
 *
 * Persisted to localStorage under `orgii_background_config`.
 */
import { atom } from "jotai";

import {
  getBackgroundColorPresetById,
  resolveBackgroundColorPreset,
} from "@src/config/appearance/backgroundColors";
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
  /** Applied CSS color. Presets use app background tokens; custom colors use literal values. */
  backgroundColor?: string;
  /**
   * Stable ID of the active preset desktop background color (e.g. "classic",
   * "ocean"). Absent for custom colors and image backgrounds.
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

const DEFAULT_BACKGROUND_COLOR_ID = "graphite";

const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  imageUrl: DEFAULT_BUNDLED_BACKGROUND_IMAGE,
  blurAmount: 0,
  customImages: [],
  customColors: [],
  adaptiveColors: true,
  backgroundColorId: DEFAULT_BACKGROUND_COLOR_ID,
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
 * Resolved background config: when a preset ID is active, ensures
 * `backgroundColor` points at the preset's app background CSS slot. Theme CSS
 * owns the slot values, so the selected ID follows Light / Dark / High Contrast.
 */
export const resolvedBackgroundConfigAtom = atom<BackgroundConfig>((get) => {
  const config = get(backgroundConfigAtom);
  const presetId = config.backgroundColorId;
  if (!presetId) return config;
  const preset = getBackgroundColorPresetById(presetId);
  if (!preset) return config;
  return {
    ...config,
    backgroundColor: resolveBackgroundColorPreset(preset),
  };
});
resolvedBackgroundConfigAtom.debugLabel = "resolvedBackgroundConfigAtom";
