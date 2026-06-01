/**
 * LiquidGlassToolbar Component
 *
 * A WebGL-based liquid glass container for toolbars.
 * Provides real refraction, dispersion, fresnel reflection, and glare effects.
 *
 * Features:
 * - WebGL 2 multi-pass rendering
 * - Real refraction with SDF shapes
 * - Chromatic dispersion (rainbow edge effects)
 * - Fresnel reflection at grazing angles
 * - Directional glare with configurable angle
 * - Multi-pass Gaussian blur
 *
 * Usage:
 * ```tsx
 * <LiquidGlassToolbar height={52} radius={12}>
 *   <ToolbarButton icon={RefreshCw} onClick={onRefresh} />
 *   <ToolbarButton icon={Plus} onClick={onAdd} />
 * </LiquidGlassToolbar>
 * ```
 */
import React, { forwardRef, useMemo } from "react";

import { useBackgroundSource } from "@src/hooks/theme/useBackgroundSource";
import { useIsCompactChromeSurface } from "@src/modules/shared/layouts/useCompactLayout";

import type { BackgroundSource } from "./backgroundSource";
import type { GlassPreset } from "./config";
import {
  SUBTLE_GLASS_PRESET,
  THICK_GLASS_PRESET,
  TOOLBAR_GLASS_PRESET,
} from "./config";
import { useLiquidGlassRenderer } from "./useLiquidGlassRenderer";

// ============================================
// Types
// ============================================

export interface LiquidGlassToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Children content */
  children?: React.ReactNode;
  /** Height of the toolbar in pixels, or "auto" for flexible height */
  height?: number | "auto";
  /** Border radius in pixels */
  radius?: number;
  /** Padding (CSS value) */
  padding?: string | number;
  /** Gap between children */
  gap?: number;
  /** Glass effect intensity */
  intensity?: "subtle" | "default" | "thick";
  /** Custom glass preset (overrides intensity) */
  preset?: GlassPreset;
  /** Background color override (for solid color backgrounds) */
  backgroundColor?: string;
  /**
   * Pin width to match numeric height so pill chrome renders as a true circle
   * for single icon controls (avoids slight flex stretch / border-box drift).
   */
  square?: boolean;
  /** Additional className */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
}

// ============================================
// Component
// ============================================

export const LiquidGlassToolbar = forwardRef<
  HTMLDivElement,
  LiquidGlassToolbarProps
>(
  (
    {
      children,
      height = 52,
      radius = 100, // Default to pill shape (clamped to half height)
      padding = "0 12px",
      gap = 8,
      intensity = "default",
      preset: customPreset,
      backgroundColor: backgroundColorProp,
      className = "",
      square = false,
      style,
      ...props
    },
    ref
  ) => {
    const globalSource = useBackgroundSource();

    // A per-instance backgroundColor prop wins over whatever the global config
    // resolves to. This is rare (only used by callers that want to force a
    // solid-color toolbar regardless of the wallpaper).
    const source = useMemo<BackgroundSource>(() => {
      if (backgroundColorProp) {
        return { kind: "color", value: backgroundColorProp };
      }
      return globalSource;
    }, [backgroundColorProp, globalSource]);

    // Compact layout puts the entire app on a flat bg-bg-2 surface, so the
    // wallpaper isn't visible behind the toolbar — sampling it for WebGL
    // refraction would just produce a tinted-grey blur. Fall back to the
    // same CSS pill we use in native Liquid Glass mode for visual parity.
    // Wallpaper routes (start page, walkthrough, repo picker) keep WebGL
    // sampling on — see `useIsCompactChromeSurface`.
    const isCompactLayout = useIsCompactChromeSurface();

    // In Liquid Glass mode (source.kind === "none") the native macOS window
    // IS the background. There is no [data-background-layer] DOM element for
    // WebGL UV mapping, so we skip the renderer entirely and use a pure CSS
    // pill instead.
    const isLiquidGlassMode = source.kind === "none" || isCompactLayout;

    const preset = useMemo(() => {
      if (customPreset) return customPreset;
      switch (intensity) {
        case "subtle":
          return SUBTLE_GLASS_PRESET;
        case "thick":
          return THICK_GLASS_PRESET;
        default:
          return TOOLBAR_GLASS_PRESET;
      }
    }, [customPreset, intensity]);

    const { canvasRef, isBackgroundReady } = useLiquidGlassRenderer({
      preset,
      radius,
      source,
      enabled: !isLiquidGlassMode,
    });

    const containerStyle: React.CSSProperties = {
      position: "relative",
      display: "flex",
      alignItems: height === "auto" ? "stretch" : "center",
      flexDirection: height === "auto" ? "column" : "row",
      height: height === "auto" ? "auto" : `${height}px`,
      minHeight: height === "auto" ? undefined : `${height}px`,
      padding: typeof padding === "number" ? `${padding}px` : padding,
      gap: `${gap}px`,
      borderRadius: `${radius}px`,
      overflow: "hidden",
      ...style,
      ...(typeof height === "number" && square
        ? {
            width: `${height}px`,
            minWidth: `${height}px`,
            maxWidth: `${height}px`,
            flexShrink: 0,
            boxSizing: "content-box",
            justifyContent: "center",
          }
        : {}),
    };

    // Pure CSS pill for Liquid Glass mode — the native NSGlassEffectView
    // already provides the blur/tint on the window layer. Surface fill uses
    // the global bg-bg-2 token so toolbar chrome matches flat chrome routes.
    // Non-compact Liquid Glass keeps a light backdrop blur behind the same fill.
    if (isLiquidGlassMode) {
      const pillClassName = [
        "border border-border-1 bg-bg-2",
        isCompactLayout ? "shadow-none" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      const cssPillStyle: React.CSSProperties = {
        ...containerStyle,
        ...(isCompactLayout
          ? {}
          : {
              backdropFilter: "blur(24px) saturate(1.6) brightness(1.05)",
              WebkitBackdropFilter: "blur(24px) saturate(1.6) brightness(1.05)",
            }),
      };

      return (
        <div
          ref={ref}
          className={pillClassName}
          style={cssPillStyle}
          {...props}
        >
          {children}
        </div>
      );
    }

    // WebGL path for normal (non-liquid-glass) backgrounds
    const fallbackStyle: React.CSSProperties = {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      borderRadius: "inherit",
      pointerEvents: "none",
      zIndex: 0,
      backdropFilter: "blur(20px) saturate(1.8)",
      WebkitBackdropFilter: "blur(20px) saturate(1.8)",
      backgroundColor: "rgba(255, 255, 255, 0.15)",
    };

    const canvasStyle: React.CSSProperties = {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      borderRadius: "inherit",
      pointerEvents: "none",
      zIndex: 1,
      opacity: isBackgroundReady ? 1 : 0,
      transition: "opacity 0.3s ease",
    };

    const contentStyle: React.CSSProperties = {
      position: "relative",
      display: "flex",
      flexDirection: height === "auto" ? "column" : "row",
      alignItems: height === "auto" ? "stretch" : "center",
      gap: "inherit",
      width: "100%",
      height: height === "auto" ? "auto" : "100%",
      zIndex: 2,
    };

    return (
      <div ref={ref} className={className} style={containerStyle} {...props}>
        <div style={fallbackStyle} />
        <canvas ref={canvasRef} style={canvasStyle} />
        <div style={contentStyle}>{children}</div>
      </div>
    );
  }
);

LiquidGlassToolbar.displayName = "LiquidGlassToolbar";

export default LiquidGlassToolbar;

// Re-export config and types
export type { GlassPreset } from "./config";
export {
  TOOLBAR_GLASS_PRESET,
  THICK_GLASS_PRESET,
  SUBTLE_GLASS_PRESET,
} from "./config";
export { useLiquidGlassRenderer } from "./useLiquidGlassRenderer";
