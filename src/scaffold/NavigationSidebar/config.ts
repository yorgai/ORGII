/**
 * Sidebar Configuration
 *
 * Centralized configuration for sidebar styling and behavior.
 */

// ============================================
// Style Configuration
// ============================================

export const SIDEBAR_STYLE = {
  /** Traffic lights reserved space */
  trafficLightsPadding: 80,
  /** Top bar height */
  topBarHeight: 36,
  /** Search input height */
  searchHeight: 28,
  /** Action button size */
  actionButtonSize: 28,
  /** Item height */
  itemHeight: 36,
  /** Group header height */
  groupHeaderHeight: 28,
  /** Border radius */
  borderRadius: 20,
  /** Item border radius */
  itemBorderRadius: 6,
  /** Drop shadow for the sidebar glass panel (subtle depth against the desktop) */
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.08)",
} as const;

// ============================================
// Padding Configuration
// ============================================

export const SIDEBAR_PADDING = {
  /** Horizontal padding for section content (px) - px-2 = 8px */
  sectionX: 8,
  /** Top padding for section content (px) - pt-4 = 16px */
  sectionTop: 16,
  /** Gap between sections (px) */
  sectionGap: 8,
  /** Internal item padding (px) */
  itemX: 8,
  /** Section header height (px) */
  sectionHeaderHeight: 28,
} as const;

// ============================================
// Glass Configuration
// ============================================

export const SIDEBAR_GLASS_CONFIG = {
  material: "medium" as const,
  region: "sidebar" as const,
  radius: SIDEBAR_STYLE.borderRadius,
  saturation: 180,
  enableBorder: true,
  enableSpecular: false,
  enableLighting: true,
  lightAngle: -45,
  lightIntensity: 0.5,
  depthIntensity: 0.4,
} as const;
