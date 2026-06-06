/**
 * AppGrid Configuration
 *
 * Defines the apps displayed in the home page Launchpad grid.
 * Icons derived from central routes (src/config/routes.ts) where the app
 * maps to a route; otherwise from ICON_CONFIG.
 */
import {
  ChartNoAxesGantt,
  ChevronsLeftRightEllipsis,
  Code2,
  Database,
  Globe,
  History,
  ListTodo,
  Network,
  Play,
  Radar,
  Rocket,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  buildAgentOrgsPath,
  buildIntegrationsPath,
  getSegmentIcon,
} from "@src/config/mainAppPaths";
import {
  ROUTES,
  getIconComponentForPath,
  getIconForPath,
} from "@src/config/routes";

// ============================================
// Icon Config
// ============================================

export const ICON_CONFIG = {
  projects: ListTodo,
  dbManager: Database,
  changelog: ChartNoAxesGantt,
  opsControl: Radar,
  startSession: Play,
  integrations: ChevronsLeftRightEllipsis,
  launchpad: Rocket,
  agentOrgs: Network,
  browser: Globe,
  editor: Code2,
  settings: Settings,
} as const;

// ============================================
// Types
// ============================================

export interface AppItem {
  /** Unique identifier */
  id: string;
  /** Full i18n key for the app label */
  labelKey: string;
  /** Lucide icon component (from ICON_CONFIG) */
  icon: LucideIcon;
  /** Lucide icon name for hover animation strategy lookup */
  iconName: string;
  /** Action identifier for optional ActionSystem dispatch */
  action: string;
  /** Route path used by fallback navigation and generic ActionSystem navigation */
  routePath: string;
}

// ============================================
// App Grid Items
// ============================================

const devRecordIcon =
  getIconComponentForPath(ROUTES.app.journey.record.path) ?? History;
const devRecordIconName =
  getIconForPath(ROUTES.app.journey.record.path) ?? "history";
const economyIcon = getSegmentIcon("market") ?? ICON_CONFIG.settings;

export const APP_GRID_ITEMS: AppItem[] = [
  // ========== Row 1 (4 items) ==========
  {
    id: "changelog",
    labelKey: "navigation:routes.changelog",
    icon: ICON_CONFIG.changelog,
    iconName: "chart-no-axes-gantt",
    action: "changelog",
    routePath: ROUTES.app.home.changelog.path,
  },
  {
    id: "economy",
    labelKey: "navigation:labels.economy",
    icon: economyIcon,
    iconName: "badge-cent",
    action: "economy",
    routePath: ROUTES.app.market.tokenMarket.path,
  },
  {
    id: "launchpad",
    labelKey: "navigation:routes.launchpad",
    icon: ICON_CONFIG.launchpad,
    iconName: "rocket",
    action: "launchpad",
    // Launchpad is no longer a standalone Workstation host — its dashboard
    // and per-repo views are pinned tabs inside the Code Editor surface.
    // The start-page tile lands the user on the editor route, where the
    // pinned dashboard tab is the first fixture.
    routePath: ROUTES.workStation.code.path,
  },
  {
    id: "dev-record",
    labelKey: "navigation:labels.devRecord",
    icon: devRecordIcon,
    iconName: devRecordIconName,
    action: "dev-record",
    routePath: ROUTES.app.journey.record.path,
  },

  // ========== Row 2 (5 items - center row) ==========
  {
    id: "integrations",
    labelKey: "navigation:labels.integrations",
    icon: ICON_CONFIG.integrations,
    iconName: "chevrons-left-right-ellipsis",
    action: "integrations",
    routePath: buildIntegrationsPath({ category: "models" }),
  },
  {
    id: "ops-control",
    labelKey: "navigation:routes.kanban",
    icon: ICON_CONFIG.opsControl,
    iconName: "radar",
    action: "ops-control",
    routePath: ROUTES.workStation.kanban.path,
  },
  {
    id: "create-session",
    labelKey: "navigation:routes.startSession",
    icon: ICON_CONFIG.startSession,
    iconName: "play",
    action: "create-session",
    routePath: ROUTES.workStation.base.path,
  },
  {
    id: "agent-orgs",
    labelKey: "navigation:labels.agentOrgs",
    icon: ICON_CONFIG.agentOrgs,
    iconName: "network",
    action: "agent-orgs",
    routePath: buildAgentOrgsPath({ tab: "agents" }),
  },
  {
    id: "settings",
    labelKey: "common:tabs.settings",
    icon: ICON_CONFIG.settings,
    iconName: "settings",
    action: "settings",
    routePath: ROUTES.app.settings.path,
  },

  // ========== Row 3 (4 items) ==========
  {
    id: "editor",
    labelKey: "navigation:labels.editor",
    icon: ICON_CONFIG.editor,
    iconName: "code-2",
    action: "editor",
    routePath: ROUTES.workStation.code.path,
  },
  {
    id: "browser",
    labelKey: "navigation:labels.browser",
    icon: ICON_CONFIG.browser,
    iconName: "globe",
    action: "browser",
    routePath: ROUTES.workStation.browser.path,
  },
  {
    id: "db-manager",
    labelKey: "navigation:labels.dbManager",
    icon: ICON_CONFIG.dbManager,
    iconName: "database",
    action: "db-manager",
    routePath: ROUTES.workStation.database.path,
  },
  {
    id: "projects",
    labelKey: "navigation:labels.projects",
    icon: ICON_CONFIG.projects,
    iconName: "chart-no-axes-gantt",
    action: "projects",
    routePath: ROUTES.workStation.project.path,
  },
];
