/**
 * ContextMenu Configuration
 *
 * Centralized configuration for the unified context menu.
 * Includes icon definitions, menu items, and keyboard shortcuts.
 */
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Code,
  DatabaseZap,
  File,
  Folder,
  GitBranch,
  Globe,
  ListChecks,
  Loader2,
  MessageSquare,
  Search,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ============================================
// Types
// ============================================

export type MenuItemId =
  | "recent"
  | "files"
  | "folder"
  | "terminals"
  | "terminal"
  | "sessions"
  | "session"
  | "browser"
  | "repo"
  | "branch"
  | "projects"
  | "project"
  | "workitem"
  | "codebase";

export type SecondLayerId =
  | "files"
  | "terminals"
  | "sessions"
  | "browser"
  | "projects"
  | "codebase";

export interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: LucideIcon;
  hasSecondLayer: boolean;
  shortcut?: string;
  description?: string;
}

export interface RecentFile {
  path: string;
  name: string;
  type: "file" | "folder";
}

// ============================================
// Icon Configuration
// ============================================

export const ICON_CONFIG = {
  recent: Clock,
  files: File,
  folders: Folder,
  terminals: Terminal,
  sessions: MessageSquare,
  browser: Globe,
  repo: Code,
  branch: GitBranch,
  projects: ListChecks,
  codebase: DatabaseZap,
  arrow: ArrowRight,
  arrowBack: ArrowLeft,
  search: Search,
  loading: Loader2,
  empty: File,
} as const;

// ============================================
// Second Layer Configuration
// ============================================

export interface SecondLayerConfig {
  title: string;
  icon: LucideIcon;
}

export const SECOND_LAYER_CONFIG: Record<SecondLayerId, SecondLayerConfig> = {
  files: {
    title: "Files & Folders",
    icon: ICON_CONFIG.files,
  },
  terminals: {
    title: "Terminal",
    icon: ICON_CONFIG.terminals,
  },
  sessions: {
    title: "Sessions",
    icon: ICON_CONFIG.sessions,
  },
  browser: {
    title: "Browser",
    icon: ICON_CONFIG.browser,
  },
  projects: {
    title: "Work Items",
    icon: ICON_CONFIG.projects,
  },
  codebase: {
    title: "Codebase Search",
    icon: ICON_CONFIG.codebase,
  },
};

// ============================================
// Menu Configuration
// ============================================

export const MENU_ITEMS: MenuItem[] = [
  {
    id: "files",
    label: "Files & Folders",
    icon: ICON_CONFIG.files,
    hasSecondLayer: true,
    description: "Search for files and folders",
  },
  {
    id: "terminals",
    label: "Terminal",
    icon: ICON_CONFIG.terminals,
    hasSecondLayer: true,
    description: "Select terminal",
  },
  {
    id: "sessions",
    label: "Sessions",
    icon: ICON_CONFIG.sessions,
    hasSecondLayer: true,
    description: "Reference a session",
  },
  {
    id: "browser",
    label: "Browser",
    icon: ICON_CONFIG.browser,
    hasSecondLayer: true,
    description: "Reference a browser tab",
  },
  {
    id: "projects",
    label: "Work Items",
    icon: ICON_CONFIG.projects,
    hasSecondLayer: true,
    description: "Reference a project or work item",
  },
  {
    id: "codebase",
    label: "Codebase",
    icon: ICON_CONFIG.codebase,
    hasSecondLayer: true,
    description: "Semantic search across codebase",
  },
];

// ============================================
// Keyboard Shortcuts
// ============================================

export const KEYBOARD_CONFIG = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  enter: "Enter",
  escape: "Escape",
  tab: "Tab",
} as const;

// ============================================
// Style Configuration
// ============================================

export const STYLE_CONFIG = {
  dropdownWidth: "280px",
  secondLayerWidth: "320px",
  /** Scrollable list cap — keep menus from dominating the viewport */
  maxHeight: "260px",
  itemHeight: "32px",
  recentSectionMaxItems: 3,
  searchResultsMaxItems: 20,
} as const;

/** List row highlight — fill-2 background with primary labels. */
export const CONTEXT_MENU_ITEM_ROW = {
  selected: "bg-fill-2 font-medium text-primary-6",
  hoverIdle: "hover:bg-fill-2 hover:text-primary-6",
} as const;

// ============================================
// Utility Functions
// ============================================

export { getFileName } from "@src/util/file/pathUtils";

/**
 * Truncate path for display
 */
export const truncatePath = (path: string, maxLength: number = 40): string => {
  if (path.length <= maxLength) return path;
  return "..." + path.slice(-maxLength + 3);
};
