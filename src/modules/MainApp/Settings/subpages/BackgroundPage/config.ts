/**
 * Background Page Configuration
 * Contains all preset data for background customization
 */
import BambooBlueBg from "@src/assets/bg/bamboo-blue.jpg";
import BambooGreenBg from "@src/assets/bg/bamboo-green.jpg";
import MountainBlueBg from "@src/assets/bg/mountain-blue.jpg";
import MountainGreenBg from "@src/assets/bg/mountain-green.jpg";
import {
  BACKGROUND_COLOR_PAIRS,
  getColorPairById as getColorPairByIdShared,
  resolveColorPair as resolveColorPairShared,
} from "@src/config/appearance/backgroundColorPairs";

import type { AnimationPreset, ImagePreset } from "./types";

// ═══════════════════════════════════════════════════════════════
// PRESET IMAGES
// ═══════════════════════════════════════════════════════════════

export const PRESET_IMAGES: ImagePreset[] = [
  {
    label: "Bamboo Blue",
    value: BambooBlueBg,
    thumbnail: BambooBlueBg,
  },
  {
    label: "Bamboo Green",
    value: BambooGreenBg,
    thumbnail: BambooGreenBg,
  },
  {
    label: "Mountain Blue",
    value: MountainBlueBg,
    thumbnail: MountainBlueBg,
  },
  {
    label: "Mountain Green",
    value: MountainGreenBg,
    thumbnail: MountainGreenBg,
  },
];

// ═══════════════════════════════════════════════════════════════
// ANIMATION PRESETS
// ═══════════════════════════════════════════════════════════════

export const PRESET_ANIMATIONS: AnimationPreset[] = [
  // Featured default — surfaces first regardless of theme mode so the toggle's
  // "first available" pick is the calm, well-loved snow preset.
  {
    id: "snow",
    label: "snow",
    description: "Falling snowflakes",
    themeMode: "both",
  },
  // Dark theme
  {
    id: "matrix",
    label: "matrix",
    description: "Digital rain",
    themeMode: "dark",
  },
  {
    id: "fireflies",
    label: "fireflies",
    description: "Glowing fireflies",
    themeMode: "dark",
  },
  {
    id: "stars",
    label: "stars",
    description: "Twinkling stars",
    themeMode: "dark",
  },
  {
    id: "aurora",
    label: "aurora",
    description: "Northern lights",
    themeMode: "dark",
  },
  {
    id: "pulse",
    label: "pulse",
    description: "Radar rings",
    themeMode: "dark",
  },
  // Retro Dev
  {
    id: "retro-phosphor",
    label: "retro-phosphor",
    description: "CRT green phosphor",
    themeMode: "dark",
  },
  {
    id: "retro-synthwave",
    label: "retro-synthwave",
    description: "80s perspective grid",
    themeMode: "dark",
  },
  // Light theme
  {
    id: "sakura",
    label: "sakura",
    description: "Cherry blossoms",
    themeMode: "light",
  },
  {
    id: "maple",
    label: "maple",
    description: "Autumn leaves",
    themeMode: "light",
  },
  // Zen
  {
    id: "koi",
    label: "koi",
    description: "Swimming koi fish",
    themeMode: "both",
  },
  {
    id: "ripples",
    label: "ripples",
    description: "Water ripples",
    themeMode: "both",
  },
  // Both themes
  {
    id: "rain",
    label: "rain",
    description: "Gentle rain",
    themeMode: "both",
  },
  {
    id: "particles",
    label: "particles",
    description: "Floating particles",
    themeMode: "both",
  },
  {
    id: "waves",
    label: "waves",
    description: "Gentle waves",
    themeMode: "both",
  },
];

// ═══════════════════════════════════════════════════════════════
// COLOR PRESETS
// Curated paired palette. Each entry resolves to a "light" hex (used in
// light mode) and a "dark" hex (used in dark mode). Switching the
// appearance mode automatically swaps to the paired value.
// Re-exported from the canonical appearance config so the UI grid and the
// `resolvedBackgroundConfigAtom` share the exact same source of truth.
// ═══════════════════════════════════════════════════════════════

export const PRESET_COLORS = BACKGROUND_COLOR_PAIRS;
export const getColorPairById = getColorPairByIdShared;
export const resolveColorPair = resolveColorPairShared;

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// Re-exported from the canonical appearance config layer so the BackgroundPage
// UI can keep importing from this file while the store layer (uiAtom,
// backgroundInit) no longer needs to reach into a Settings sub-page.
// ═══════════════════════════════════════════════════════════════

export {
  CUSTOM_COLOR_STORAGE_KEY,
  DEFAULT_BUNDLED_BACKGROUND_IMAGE,
} from "@src/config/appearance/backgroundConfig";
export const DEFAULT_CUSTOM_COLOR = "#1a1a2e";
/** Upper bound for DIY solid colors saved in background config */
export const MAX_CUSTOM_BACKGROUND_COLORS = 24;

// Animation emoji mapping
export const ANIMATION_EMOJIS: Record<string, string> = {
  matrix: "🟢",
  fireflies: "🪲",
  stars: "⭐",
  aurora: "🌌",
  pulse: "📡",
  "retro-phosphor": "📟",
  "retro-synthwave": "🌅",
  snow: "❄️",
  sakura: "🌸",
  maple: "🍁",
  koi: "🐟",
  ripples: "💧",
  rain: "🌧️",
  particles: "✨",
  waves: "🌊",
};

// Matrix character set options
export const MATRIX_CHAR_SET_OPTIONS = [
  {
    value: "binary" as const,
    labelKey: "background.matrixBinary",
    example: "01010",
  },
  {
    value: "latin" as const,
    labelKey: "background.matrixLatin",
    example: "ABC",
  },
  {
    value: "symbols" as const,
    labelKey: "background.matrixSymbols",
    example: "#$%",
  },
  {
    value: "katakana" as const,
    labelKey: "background.matrixKatakana",
    example: "カタ",
  },
];
