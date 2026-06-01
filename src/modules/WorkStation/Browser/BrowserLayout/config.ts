/**
 * BrowserLayout Configuration
 *
 * Constants and configuration for the Browser layout.
 */
import type { TFunction } from "i18next";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import type { QuickAction } from "@src/modules/WorkStation/shared";

// ============================================
// Types
// ============================================

export interface BrowserQuickActionsOptions {
  t: TFunction;
  onNewTab: () => void;
  onNewPrivateTab: () => void;
  sidebarCollapsed: boolean;
  devToolsCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleDevTools: () => void;
}

// ============================================
// Quick Actions
// ============================================

/**
 * Creates quick actions for the browser placeholder.
 * Factory function to inject spotlight dependency.
 */
export function createBrowserQuickActions(
  options: BrowserQuickActionsOptions
): QuickAction[] {
  const {
    t,
    onNewTab,
    onNewPrivateTab,
    sidebarCollapsed,
    devToolsCollapsed,
    onToggleSidebar,
    onToggleDevTools,
  } = options;

  return [
    {
      id: "new-tab",
      label: t("commands.newTab"),
      shortcut: getShortcutKeys("browser_new_tab"),
      onAction: onNewTab,
    },
    {
      id: "new-private-tab",
      label: t("commands.newPrivateTab"),
      onAction: onNewPrivateTab,
    },
    {
      id: "toggle-sidebar",
      label: sidebarCollapsed
        ? t("commands.showPrimarySidebar")
        : t("commands.hidePrimarySidebar"),
      shortcut: getShortcutKeys("browser_sidebar"),
      onAction: onToggleSidebar,
    },
    {
      id: "toggle-devtools",
      label: devToolsCollapsed
        ? t("commands.showDevTools")
        : t("commands.hideDevTools"),
      shortcut: getShortcutKeys("browser_devtools"),
      onAction: onToggleDevTools,
    },
  ];
}
