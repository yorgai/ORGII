/**
 * Background Page Utility Functions
 *
 * normalizeHexColor and sanitizeCustomColorsArray are canonical in
 * @src/config/appearance/backgroundConfig and re-exported here so
 * BackgroundPage components can keep their existing import path.
 */
import type { AnimationPreset, ColorPair, ImagePreset } from "./types";

export {
  normalizeHexColor,
  sanitizeCustomColorsArray,
} from "@src/config/appearance/backgroundConfig";

/**
 * Get display label for current background configuration
 */
export function getBackgroundLabel(
  config: {
    backgroundColor?: string;
    backgroundColorId?: string;
    imageUrl?: string;
    selectedImageId?: string;
    animation?: string;
  },
  presetImages: ImagePreset[],
  presetColors: ColorPair[],
  presetAnimations: AnimationPreset[]
): string {
  let baseLabel = "";

  if (config.backgroundColorId) {
    const pair = presetColors.find(
      (item) => item.id === config.backgroundColorId
    );
    baseLabel = pair?.label || "Custom Color";
  } else if (config.backgroundColor) {
    baseLabel = "Custom Color";
  } else if (config.selectedImageId) {
    baseLabel = "Custom Image";
  } else if (config.imageUrl) {
    const preset = presetImages.find((img) => img.value === config.imageUrl);
    baseLabel = preset?.label || "Custom Image";
  } else {
    baseLabel = presetImages[0]?.label || "Default";
  }

  // Add animation overlay label if present
  if (config.animation) {
    const anim = presetAnimations.find(
      (animation) => animation.id === config.animation
    );
    if (anim) {
      baseLabel += ` + ${anim.label}`;
    }
  }

  return baseLabel;
}

/**
 * Filter presets by theme mode
 */
export function filterByTheme<
  T extends { themeMode: "dark" | "light" | "both" },
>(items: T[], isDarkTheme: boolean): T[] {
  return items.filter((item) => {
    if (item.themeMode === "both") return true;
    if (isDarkTheme && item.themeMode === "dark") return true;
    if (!isDarkTheme && item.themeMode === "light") return true;
    return false;
  });
}

/**
 * Get theme display name from theme path
 */
export function getThemeDisplayName(themePath: string): string {
  if (themePath.includes("orgii_high_contrast")) return "High Contrast";
  if (themePath.includes("orgii_dark")) return "Dark";
  return "Light";
}
