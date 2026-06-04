/**
 * View Container Tokens
 *
 * Shared class strings and style helpers for view containers (WorkStation,
 * SessionWorkspace) and page panels (MainAppShell, ShellFallback).
 */
import type { CSSProperties } from "react";

import { ROUTES } from "@src/config/routes";

/**
 * Routes that intentionally bleed the wallpaper through chrome even when the
 * user has picked the compact global layout. Each of these owns a hero canvas,
 * illustration, or centered card on the background layer.
 *
 * Centralized so shared chrome agrees on the exception list — adding a new
 * wallpaper route is a one-line change.
 */
const WALLPAPER_ROUTE_PREFIXES: readonly string[] = [
  ROUTES.app.home.start.path,
  ROUTES.app.home.selectRepo.path,
  ROUTES.auth.login.path,
  ROUTES.auth.setup.path,
  ROUTES.app.market.callback.path,
];

export function isWallpaperRoutePath(pathname: string): boolean {
  return WALLPAPER_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Page/panel background variants - shared by MainAppShell, ShellFallback, view containers */
export const PAGE_PANEL_BG = {
  /** Rounded corners, used for inset/card layout */
  rounded: "rounded-page bg-bg-2",
  /** Flat, no radius - used for full/edge layout */
  flat: "bg-bg-2",
} as const;

/** View container class strings for modules/index.tsx */
export const VIEW_CONTAINER_CLASSES = {
  /** Full mode: edge-to-edge with bg for loading state (no rounded corners) */
  fullWithBg: `absolute inset-0 ${PAGE_PANEL_BG.flat}`,
  /** Inset mode: card-like with rounded corners and bg for loading state */
  insetWithBg: `absolute inset-0 ${PAGE_PANEL_BG.rounded}`,
  /**
   * Compact mode: same as full visually (flat, no radius), but reserved as a
   * separate token so consumers can branch by mode rather than infer from
   * `flat` alone.
   */
  compactWithBg: `absolute inset-0 ${PAGE_PANEL_BG.flat}`,
} as const;

/** Style for visibility toggle - prevents flash when switching views */
export function getViewToggleStyle(
  isVisible: boolean,
  zIndexWhenVisible = 10
): CSSProperties {
  return {
    visibility: isVisible ? "visible" : "hidden",
    display: isVisible ? "block" : "none",
    zIndex: isVisible ? zIndexWhenVisible : -1,
  };
}

/** CSS containment for layout isolation - used by outlet containers */
export const LAYOUT_CONTAIN_STYLE: CSSProperties = {
  contain: "layout style",
};
