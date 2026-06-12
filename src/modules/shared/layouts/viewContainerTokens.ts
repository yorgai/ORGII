/**
 * View Container Tokens
 *
 * Shared class strings and style helpers for view containers (WorkStation,
 * SessionWorkspace) and page panels (MainAppShell, ShellFallback).
 */
import type { CSSProperties } from "react";

import { ROUTES } from "@src/config/routes";
import {
  sanitizePageOpacity,
  sanitizeSidebarOpacity,
} from "@src/store/ui/backgroundConfigAtom";

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

/**
 * Page/panel background variants — shared by MainAppShell, ShellFallback,
 * view containers.
 *
 * NOTE: the surface paint (`bg-bg-2`) lives on the inline style produced
 * by `getPagePanelBackgroundStyle()` so it can honor the page opacity
 * setting. These class tokens only contribute geometry (radius), not
 * color, to avoid re-painting an opaque layer on top.
 */
export const PAGE_PANEL_BG = {
  /** Rounded corners, used for inset/card layout */
  rounded: "rounded-page",
  /** Flat, no radius - used for full/edge layout */
  flat: "",
} as const;

/**
 * View container class strings for modules/index.tsx
 *
 * `WithBg` suffix preserved for backward-compat in caller code. The
 * surface paint actually arrives via `getPagePanelBackgroundStyle()`
 * applied by MainAppShell / ShellFallback — these classes contribute
 * only geometry. Loading-state callers that mount these containers
 * standalone (outside MainAppShell) keep an explicit `bg-bg-2` token
 * so they don't render transparent.
 */
export const VIEW_CONTAINER_CLASSES = {
  /** Full mode: edge-to-edge with bg for loading state (no rounded corners) */
  fullWithBg: "absolute inset-0 bg-bg-2",
  /** Inset mode: card-like with rounded corners and bg for loading state */
  insetWithBg: "absolute inset-0 rounded-page bg-bg-2",
  /**
   * Compact mode: same as full visually (flat, no radius), but reserved as a
   * separate token so consumers can branch by mode rather than infer from
   * `flat` alone.
   */
  compactWithBg: "absolute inset-0 bg-bg-2",
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

/**
 * Build the inline style for the page panel surface. Always emits a
 * `backgroundColor` (via `color-mix`) so callers can drop the redundant
 * `bg-bg-2` Tailwind class — there's a single source of truth for the
 * surface paint. At 100% opacity the mix collapses to `var(--color-bg-2)`.
 */
export function getPagePanelBackgroundStyle(
  pageOpacity: number | undefined
): CSSProperties {
  const opacity = sanitizePageOpacity(pageOpacity);
  return {
    backgroundColor: `color-mix(in srgb, var(--color-bg-2) ${opacity}%, transparent)`,
  };
}

/** Same as `getPagePanelBackgroundStyle` but for the sidebar surface. */
export function getSidebarSurfaceBackgroundStyle(
  sidebarOpacity: number | undefined
): CSSProperties {
  const opacity = sanitizeSidebarOpacity(sidebarOpacity);
  return {
    backgroundColor: `color-mix(in srgb, var(--sidebar-bg) ${opacity}%, transparent)`,
  };
}

/**
 * Inline style for the chat panel root. Sets its own background and
 * rebinds `--color-chat-pane` on this subtree so every descendant Tailwind
 * `bg-chat-pane` class (sticky group headers, pagination toolbar wrapper,
 * turn-page list, loading bar, agent-org overview panel, etc.)
 * automatically inherits the same transparency.
 *
 * `--color-chat-container` is intentionally NOT rebound: it backs distinct
 * cards/badges that sit on top of the chat surface (region notices, pinned
 * pop-out cards, inline tool blocks). Those should read as solid surfaces
 * over the wallpaper-tinted chat pane, not also bleed through.
 *
 * The mix reads `--color-chat-pane-base` (not `--color-chat-pane`) to
 * avoid a circular var reference once we overwrite the unsuffixed name.
 * Theme files declare both: `*-base` holds the literal color, the
 * unsuffixed name is the consumable alias.
 */
export function getChatPanelBackgroundStyle(
  pageOpacity: number | undefined
): CSSProperties {
  const opacity = sanitizePageOpacity(pageOpacity);
  const chatPaneMix = `color-mix(in srgb, var(--color-chat-pane-base) ${opacity}%, transparent)`;
  return {
    backgroundColor: chatPaneMix,
    "--color-chat-pane": chatPaneMix,
  } as CSSProperties;
}
