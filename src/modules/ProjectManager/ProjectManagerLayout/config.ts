/**
 * ProjectManagerLayout Configuration
 *
 * Constants and configuration for the Project Manager layout.
 */
import type { TFunction } from "i18next";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import type { QuickAction } from "@src/modules/WorkStation/shared";

// ============================================
// Types
// ============================================

export interface ProjectQuickActionsOptions {
  t: TFunction;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenProjects: () => void;
  onOpenWorkItems: () => void;
  onCreateProject: () => void;
  onCreateWorkItem: () => void;
}

// ============================================
// Quick Actions
// ============================================

/**
 * Creates quick actions for the project manager placeholder.
 * Factory function to inject dependencies.
 */
export function createProjectQuickActions(
  options: ProjectQuickActionsOptions
): QuickAction[] {
  const {
    t,
    sidebarCollapsed,
    onToggleSidebar,
    onOpenProjects,
    onOpenWorkItems,
    onCreateProject,
    onCreateWorkItem,
  } = options;

  return [
    {
      id: "open-work-items",
      label: t("projects:workItems.viewWorkItems"),
      onAction: onOpenWorkItems,
    },
    {
      id: "open-projects",
      label: t("projects:projects.viewProjects"),
      onAction: onOpenProjects,
    },
    {
      id: "new-project",
      label: t("projects:projects.createProject"),
      onAction: onCreateProject,
    },
    {
      id: "new-work-item",
      label: t("projects:workItems.createWorkItem"),
      onAction: onCreateWorkItem,
    },
    {
      id: "toggle-sidebar",
      label: sidebarCollapsed
        ? t("commands.showPrimarySidebar")
        : t("commands.hidePrimarySidebar"),
      shortcut: getShortcutKeys("project_toggle_sidebar"),
      onAction: onToggleSidebar,
    },
  ];
}
