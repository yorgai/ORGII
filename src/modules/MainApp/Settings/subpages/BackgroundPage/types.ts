/**
 * Background Page Types
 */

export type { BackgroundColorPreset } from "@src/config/appearance/backgroundColors";

export type ThemeMode = "dark" | "light" | "both";

export interface ImagePreset {
  label: string;
  value: string;
  thumbnail: string;
}

export interface AnimationPreset {
  id: string;
  label: string;
  description: string;
  themeMode: ThemeMode;
}

export type GlassLevel = "regular" | "medium" | "thick";

export interface BackgroundConfig {
  backgroundColor?: string;
  /** ID of the active color preset (e.g. "classic"). */
  backgroundColorId?: string;
  imageUrl?: string;
  selectedImageId?: string;
  customImages?: string[];
  /** DIY solid hex colors persisted with background config */
  customColors?: string[];
  animation?: string;
  blurAmount?: number;
  matrixCharSet?: "binary" | "latin" | "symbols" | "katakana";
  /**
   * When set, the background renders as a Glass overlay at the
   * given thickness instead of using `imageUrl` / `backgroundColor`.
   * Mutually exclusive with the image / solid-color paths.
   */
  glass?: GlassLevel;
  /**
   * When true, toolbar text and pill colors adapt to the brightness of the
   * background behind them. Defaults to true when undefined.
   */
  adaptiveColors?: boolean;
}

export interface BackgroundSettingsProps {
  /** Whether to show the back button and header */
  showHeader?: boolean;
  /**
   * When true, renders as inline section content (parent provides scroll).
   * Use inside Appearance settings; omit outer full-height shell and ScrollFadeContainer.
   */
  embedded?: boolean;
  /** Optional custom translation namespace (defaults to "settings") */
  translationNamespace?: string;
}

/** Dropdown values for Background settings — colors vs images surface */
export const BACKGROUND_CONTENT_SOURCE = {
  COLORS: "colors",
  IMAGES: "images",
} as const;
export type BackgroundContentSource =
  (typeof BACKGROUND_CONTENT_SOURCE)[keyof typeof BACKGROUND_CONTENT_SOURCE];

export interface StorageInfo {
  path: string;
  used: number;
  limit: number;
}

export type MatrixCharSet = "binary" | "latin" | "symbols" | "katakana";
