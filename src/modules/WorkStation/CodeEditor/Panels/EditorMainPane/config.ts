/**
 * EditorContent Configuration
 *
 * Constants and configuration for the main content area.
 */
import type { TFunction } from "i18next";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import type { QuickAction } from "@src/modules/WorkStation/shared";
import {
  openEditorSpotlight,
  openWorkspaceSpotlight,
} from "@src/scaffold/GlobalSpotlight/openSpotlight";
import type { PanelState } from "@src/store/workstation/tabs";

// ============================================
// Types
// ============================================

export interface EditorQuickActionsOptions {
  t: TFunction;
  dispatch: (
    action: string,
    params: Record<string, unknown>,
    source: "system" | "user" | "ai"
  ) => void;
  sidebarCollapsed: boolean;
}

// ============================================
// Default State
// ============================================

/**
 * Default empty panel state (defined outside component for stable reference)
 */
export const DEFAULT_PANEL_STATE: PanelState = {
  tabs: [],
  activeTabId: null,
};

// ============================================
// Tab Type Configuration
// ============================================

/**
 * Configuration for each tab type
 */
export const TAB_TYPE_CONFIG = {
  file: {
    supportsEdit: true,
    supportsPreview: true,
  },
  directory: {
    supportsEdit: false,
    supportsPreview: false,
  },
  explorer: {
    supportsEdit: false,
    supportsPreview: false,
  },
  "git-diff": {
    supportsEdit: true, // Unified view supports editing
    supportsPreview: false,
  },
  "source-control": {
    // Focus mode delegates to GitDiffContent which supports inline editing.
    supportsEdit: true,
    supportsPreview: false,
  },
  "git-log": {
    supportsEdit: false,
    supportsPreview: false,
  },
  "terminal-content": {
    supportsEdit: false,
    supportsPreview: false,
  },
  terminal: {
    supportsEdit: false,
    supportsPreview: false,
  },
  output: {
    supportsEdit: false,
    supportsPreview: false,
  },
  debug: {
    supportsEdit: false,
    supportsPreview: false,
  },
  settings: {
    supportsEdit: false,
    supportsPreview: false,
  },
  "lint-scan": {
    supportsEdit: false,
    supportsPreview: false,
  },
} as const;

// ============================================
// Quick Actions
// ============================================

/**
 * Creates quick actions for the editor placeholder.
 * Factory function to inject dispatch dependency.
 */
export function createEditorQuickActions(
  options: EditorQuickActionsOptions
): QuickAction[] {
  const { t, dispatch, sidebarCollapsed } = options;

  return [
    {
      id: "add-workspace",
      label: t("commands.switchWorkspace"),
      onAction: () => openWorkspaceSpotlight("switch"),
    },
    {
      id: "search-files",
      label: t("commands.searchFiles"),
      shortcut: getShortcutKeys("quick_open"),
      onAction: () => openEditorSpotlight(""),
    },
    {
      id: "toggle-primary-sidebar",
      label: sidebarCollapsed
        ? t("commands.showPrimarySidebar")
        : t("commands.hidePrimarySidebar"),
      shortcut: getShortcutKeys("toggle_workstation_sidebar"),
      onAction: () => dispatch("panel.togglePrimary", {}, "user"),
    },
  ];
}
