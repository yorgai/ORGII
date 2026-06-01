/**
 * LiquidGlass Hover Configuration
 *
 * Centralized hover overlay configuration for all liquid glass components.
 * Provides consistent hover effects across buttons, cards, and containers.
 *
 * Usage:
 * ```tsx
 * import { LIQUID_GLASS_HOVER } from "@src/components/LiquidGlass/hoverConfig";
 *
 * // In your component
 * const { isDark } = useCurrentTheme();
 *
 * <div style={{
 *   background: isDark ? LIQUID_GLASS_HOVER.dark : LIQUID_GLASS_HOVER.light
 * }} />
 * ```
 */
import { createContext, useContext } from "react";

/**
 * Hover overlay colors for liquid glass components
 *
 * - **Light mode**: 35% white overlay - bright, clearly visible
 * - **Dark mode**: 8% white overlay - subtle like Safari dark mode
 *
 * These values are optimized for:
 * - Clear interactive feedback
 * - Consistent with Apple macOS design patterns
 * - Good contrast on both light and dark backgrounds
 * - Accessible visibility for all users
 */
export const LIQUID_GLASS_HOVER = {
  light: "rgba(255, 255, 255, 0.35)", // 35% white overlay in light mode
  dark: "rgba(255, 255, 255, 0.08)", // 8% white overlay in dark mode (subtle)
} as const;

/**
 * Pressed/active overlay colors for liquid glass components
 *
 * Visually distinct from hover — uses a subtle darkening effect
 * to convey "pressed inward" feedback, matching macOS glass patterns.
 */
export const LIQUID_GLASS_PRESSED = {
  light: "rgba(0, 0, 0, 0.08)", // subtle dark tint in light mode
  dark: "rgba(255, 255, 255, 0.16)", // stronger white in dark mode
} as const;

/**
 * Helper function to get the appropriate hover overlay based on theme
 *
 * @param isDark - Whether dark mode is active
 * @returns The appropriate hover overlay color
 *
 * @example
 * ```tsx
 * const { isDark } = useCurrentTheme();
 * const hoverColor = getLiquidGlassHover(isDark);
 *
 * <div style={{ background: hoverColor }} />
 * ```
 */
export const getLiquidGlassHover = (isDark: boolean): string => {
  return isDark ? LIQUID_GLASS_HOVER.dark : LIQUID_GLASS_HOVER.light;
};

/**
 * Alternative hover overlay values for specific use cases
 */
export const LIQUID_GLASS_HOVER_VARIANTS = {
  /**
   * Subtle hover - for less prominent interactive elements
   * - Light: 20% white
   * - Dark: 5% white
   */
  subtle: {
    light: "rgba(255, 255, 255, 0.20)",
    dark: "rgba(255, 255, 255, 0.05)",
  },

  /**
   * Standard hover - recommended for most use cases (default)
   * - Light: 35% white
   * - Dark: 8% white
   */
  standard: LIQUID_GLASS_HOVER,

  /**
   * Strong hover - for high-emphasis interactive elements
   * - Light: 40% white
   * - Dark: 12% white
   */
  strong: {
    light: "rgba(255, 255, 255, 0.40)",
    dark: "rgba(255, 255, 255, 0.12)",
  },
} as const;

/**
 * Get hover overlay for a specific variant
 *
 * @param isDark - Whether dark mode is active
 * @param variant - Hover intensity variant
 * @returns The appropriate hover overlay color
 *
 * @example
 * ```tsx
 * const { isDark } = useCurrentTheme();
 * const hoverColor = getLiquidGlassHoverVariant(isDark, "subtle");
 * ```
 */
export const getLiquidGlassHoverVariant = (
  isDark: boolean,
  variant: keyof typeof LIQUID_GLASS_HOVER_VARIANTS = "standard"
): string => {
  const colors = LIQUID_GLASS_HOVER_VARIANTS[variant];
  return isDark ? colors.dark : colors.light;
};

// ============================================
// Hover Intensity Context
// ============================================

export type HoverIntensity = keyof typeof LIQUID_GLASS_HOVER_VARIANTS;

/**
 * Context that overrides the hover intensity for all LiquidGlassHoverItem
 * descendants. Wrap a subtree (e.g. HoverSidebarContainer) with
 * HoverIntensityContext.Provider to make items inside it use a stronger
 * or more subtle hover effect without prop-drilling.
 */
export const HoverIntensityContext = createContext<HoverIntensity>("standard");

export const useHoverIntensity = (): HoverIntensity =>
  useContext(HoverIntensityContext);
