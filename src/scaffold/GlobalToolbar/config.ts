/**
 * GlobalToolbar Configuration
 *
 * Centralized configuration for icons, constants, and settings
 */
// ============================================
// Icon Configuration
// ============================================

export const TOOLBAR_ICONS = {
  // Actions
  menu: "Ellipsis",
  add: "Plus",
  refresh: "RefreshCw",
  search: "Search",

  // Navigation
  sidebar: "PanelLeft",
  code: "Code",
  branch: "GitBranch",
  chevronDown: "ChevronDown",
  chevronRight: "ChevronRight",
  layers: "Layers",
} as const;

// ============================================
// Layout Configuration
// ============================================

export const TOOLBAR_SIZE = {
  height: 40,
  glassHeight: 32,
  interactiveHeight: 24,
  iconButtonSize: 24,
  roundButtonSize: 32,
  compactButtonSize: 28,
  iconSize: 14,
  switchIconSize: 14,
  radius: 100,
  gap: 8,
  innerGap: 4,
  padding: 8,
  glassPadding: "4px",
  compactGlassPadding: "0 4px",
  pillPaddingX: 12,
  compactPillPaddingX: 8,
  mediumPillPaddingX: 14,
  loadingSkeletonHeightClass: "h-8",
} as const;

export const TOOLBAR_LAYOUT = {
  height: TOOLBAR_SIZE.height,
  buttonHeight: TOOLBAR_SIZE.glassHeight,
  buttonRadius: TOOLBAR_SIZE.radius,
  gap: TOOLBAR_SIZE.gap,
  padding: TOOLBAR_SIZE.padding,

  // macOS specific (native traffic lights)
  trafficLightWidth: 78,
  trafficLightTop: 19,
  trafficLightLeft: 20,
} as const;

// ============================================
// Repo Display Parsing
// ============================================

export const REPO_LABELS = {
  github: "GitHub",
  local: "Local",
  selectRepo: "Select repo",
  selectBranch: "Select branch",
} as const;

// ============================================
// Spotlight Configuration
// ============================================

// Re-export from GlobalSpotlight
// All spotlight config is now centralized in GlobalSpotlight/config.ts
export { SPOTLIGHT_CONFIG } from "@/src/scaffold/GlobalSpotlight/config";
