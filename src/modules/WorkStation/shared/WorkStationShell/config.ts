/**
 * WorkStationShell Configuration
 *
 * Config objects consumed by `WorkStationShell`:
 * - `PrimarySidebarConfig` — the left-rail (or right-rail in reversed
 *   layout) primary sidebar: file tree, session list, etc.
 * - `SecondaryPanelConfig` — the single shared secondary panel that can
 *   live on the right rail OR at the bottom row. Mounted once; CSS grid
 *   relocates it between the two slots without remounting the content.
 *
 * Apps that don't need a secondary panel (Chat, DatabaseManager,
 * ProjectManager, SessionReplay variants) simply omit
 * `secondaryPanelConfig`; the shell falls back to a flex layout with
 * just the primary sidebar + main content.
 */
import type { ReactNode } from "react";

import { WORK_STATION_PRIMARY_SIDEBAR } from "@src/config/workStationPrimarySidebar";
import type { SecondaryPanelPosition } from "@src/store/ui/workStationLayout/secondaryPanelPositionAtoms";
import type { LayoutMode } from "@src/store/ui/workStationLayout/splitLayoutAtoms";

export type { SecondaryPanelPosition } from "@src/store/ui/workStationLayout/secondaryPanelPositionAtoms";

// ============================================
// Types
// ============================================

/** Configuration for a resizable panel */
export interface PanelConfig {
  /** Current size (width or height) */
  size: number;
  /** Callback to update size */
  onSizeChange?: (size: number) => void;
  /** Whether the panel is collapsed */
  collapsed?: boolean;
  /** Callback to close/collapse the panel */
  onClose?: () => void;
  /** Callback to move the panel between left/right workstation rails */
  onPositionChange?: (mode: LayoutMode) => void;
  /** Minimum size */
  minSize?: number;
  /** Maximum size */
  maxSize?: number;
  /** Reset size for context menu */
  resetSize?: number;
}

/** Configuration for the primary sidebar */
export interface PrimarySidebarConfig extends PanelConfig {
  /** The sidebar content */
  content: ReactNode;
}

/**
 * Configuration for a shared secondary panel that can live in either the
 * right rail OR the bottom pane of the shell. Renders exactly once; CSS grid
 * moves it between slots without remounting.
 */
export interface SecondaryPanelConfig {
  /** The panel content — mounted once regardless of position */
  content: ReactNode;
  /** Whether the secondary panel is positioned on the right or at the bottom */
  position: SecondaryPanelPosition;
  /** Whether the panel is collapsed (hidden) */
  collapsed?: boolean;
  /** Whether the panel is maximized (only when position = "bottom") */
  maximized?: boolean;
  /** Current size along the active axis (width when right, height when bottom) */
  size: number;
  /** Callback to update size */
  onSizeChange?: (size: number) => void;
  /** Callback to close/collapse the panel */
  onClose?: () => void;
  /** Minimum size */
  minSize?: number;
  /** Maximum size */
  maxSize?: number;
  /** Reset size for context menu */
  resetSize?: number;
}

// ============================================
// Defaults
// ============================================

export const DEFAULT_PRIMARY_SIDEBAR_CONFIG: Required<
  Omit<PanelConfig, "onSizeChange" | "onClose" | "onPositionChange">
> = {
  size: WORK_STATION_PRIMARY_SIDEBAR.defaultWidth,
  collapsed: false,
  minSize: WORK_STATION_PRIMARY_SIDEBAR.minWidth,
  maxSize: WORK_STATION_PRIMARY_SIDEBAR.maxWidth,
  resetSize: WORK_STATION_PRIMARY_SIDEBAR.defaultWidth,
};

// ============================================
// Builders
// ============================================

/**
 * Build a primary sidebar config from common hook state.
 *
 * @example
 * const {
 *   primarySidebarCollapsed,
 *   primarySidebarWidth,
 *   setPrimarySidebarWidth,
 *   setPrimarySidebarCollapsed,
 * } = usePrimarySidebarState();
 *
 * const primarySidebarConfig = buildPrimarySidebarConfig({
 *   content: <MySidebar />,
 *   collapsed: primarySidebarCollapsed,
 *   size: primarySidebarWidth,
 *   onSizeChange: setPrimarySidebarWidth,
 *   onClose: () => setPrimarySidebarCollapsed(true),
 * });
 */
export function buildPrimarySidebarConfig(options: {
  content: ReactNode;
  collapsed?: boolean;
  size?: number;
  onSizeChange?: (size: number) => void;
  onClose?: () => void;
  onPositionChange?: (mode: LayoutMode) => void;
  minSize?: number;
  maxSize?: number;
  resetSize?: number;
}): PrimarySidebarConfig {
  return {
    content: options.content,
    collapsed: options.collapsed ?? DEFAULT_PRIMARY_SIDEBAR_CONFIG.collapsed,
    size: options.size ?? DEFAULT_PRIMARY_SIDEBAR_CONFIG.size,
    onSizeChange: options.onSizeChange,
    onClose: options.onClose,
    onPositionChange: options.onPositionChange,
    minSize: options.minSize ?? DEFAULT_PRIMARY_SIDEBAR_CONFIG.minSize,
    maxSize: options.maxSize ?? DEFAULT_PRIMARY_SIDEBAR_CONFIG.maxSize,
    resetSize: options.resetSize ?? DEFAULT_PRIMARY_SIDEBAR_CONFIG.resetSize,
  };
}

/**
 * Build a secondary panel config (shared right/bottom slot, single mount).
 */
export function buildSecondaryPanelConfig(options: {
  content: ReactNode;
  position: SecondaryPanelPosition;
  collapsed?: boolean;
  maximized?: boolean;
  size: number;
  onSizeChange?: (size: number) => void;
  onClose?: () => void;
  minSize?: number;
  maxSize?: number;
  resetSize?: number;
}): SecondaryPanelConfig {
  return {
    content: options.content,
    position: options.position,
    collapsed: options.collapsed ?? false,
    maximized: options.maximized ?? false,
    size: options.size,
    onSizeChange: options.onSizeChange,
    onClose: options.onClose,
    minSize: options.minSize,
    maxSize: options.maxSize,
    resetSize: options.resetSize,
  };
}
