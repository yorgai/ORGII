/**
 * Spotlight Action Definitions
 *
 * Static action constants and their typed definitions for the spotlight
 * palette. Each constant is a pure data table — no React, no hooks.
 *
 * - `AGENT_SESSION_ACTIONS` — top-level agent/session entry points.
 * - `WORKSPACE_ACTIONS`     — workspace / repo switching and management.
 * - `EDITOR_ACTIONS`        — editor palette modes (file / command / symbol).
 * - `QUICK_NAVIGATION_ACTIONS` — work-station tab switchers (terminal, SCM).
 * - `buildViewActions`      — view-toggle actions whose label flips based on
 *   the current collapsed state of each sidebar/panel.
 */
import {
  ArrowLeftRight,
  Dock,
  FolderPlus,
  FolderTree,
  GitBranch,
  GitPullRequest,
  List,
  MessageCircle,
  PanelBottom,
  PanelLeft,
  Play,
  RotateCcw,
  Search,
  SquareTerminal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import {
  ACTION_ID,
  type ActionId,
} from "@src/modules/WorkStation/ActionSystem";

import type { SpotlightItem } from "../../types";

// ============================================
// Types
// ============================================

export type SpotlightStaticActionId =
  | "create-session"
  | "search-agent-sessions"
  | "switch-workspace"
  | "switch-branch"
  | "add-workspace"
  | "create-multi-repo-workspace"
  | "toggle-sidebar"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "toggle-workstation-sidebar"
  | "toggle-bottom-panel"
  | "toggle-workstation-chat-focus"
  | "toggle-workstation-chat-panel"
  | "open-search-sidebar"
  | "open-source-control-tab"
  | "open-terminal-tab";

export type SpotlightStaticActionFallback =
  | "create-session"
  | "search-agent-sessions"
  | "workspace-switch"
  | "workspace-add"
  | "workspace-create"
  | "branch-picker"
  | "toggle-sidebar"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "toggle-workstation-sidebar"
  | "toggle-bottom-panel"
  | "toggle-chat-focus"
  | "toggle-chat-panel"
  | "open-search-sidebar"
  | "open-source-control-tab"
  | "open-terminal-tab";

export type SpotlightEditorActionId =
  | "go-to-editor-file"
  | "run-editor-command"
  | "go-to-editor-symbol";

export interface SpotlightStaticActionDefinition {
  id: SpotlightStaticActionId;
  labelKey: string;
  icon: SpotlightItem["icon"];
  keywords: string[];
  shortcut?: string;
  actionId: ActionId;
  payload: Record<string, unknown>;
  fallback: SpotlightStaticActionFallback;
  closeOnSuccess: boolean;
}

export interface SpotlightEditorActionDefinition {
  id: SpotlightEditorActionId;
  modeKey: "file" | "command" | "symbol";
  labelKey: "label" | "hintLabel";
  prefix: string;
  shortcut: string;
}

// ============================================
// Static action tables
// ============================================

export const AGENT_SESSION_ACTIONS = [
  {
    id: "create-session",
    labelKey: "selectors.spotlight.actions.createSession.label",
    icon: Play,
    keywords: ["new session", "create session", "agent station", "start agent"],
    shortcut: getShortcutKeys("new_session"),
    actionId: ACTION_ID.AGENT_STATION_CREATE_SESSION,
    payload: {},
    fallback: "create-session",
    closeOnSuccess: true,
  },
  {
    id: "search-agent-sessions",
    labelKey: "selectors.spotlight.actions.searchAgentSessions.label",
    icon: Search,
    keywords: [
      "search session",
      "search sessions",
      "agent sessions",
      "open session",
      "find session",
      "session history",
    ],
    shortcut: getShortcutKeys("agent_session_search"),
    actionId: ACTION_ID.SPOTLIGHT_OPEN_AGENT_SESSION_SEARCH,
    payload: {},
    fallback: "search-agent-sessions",
    closeOnSuccess: false,
  },
] satisfies SpotlightStaticActionDefinition[];

export const WORKSPACE_ACTIONS = [
  {
    id: "switch-workspace",
    labelKey: "selectors.spotlight.actions.switchWorkspace.label",
    icon: ArrowLeftRight,
    keywords: ["switch workspace", "workspace", "repo", "repository", "folder"],
    actionId: ACTION_ID.SPOTLIGHT_OPEN_WORKSPACE_PICKER,
    payload: { mode: "switch" },
    fallback: "workspace-switch",
    closeOnSuccess: false,
  },
  {
    id: "switch-branch",
    labelKey: "selectors.spotlight.actions.switchBranch.label",
    icon: GitBranch,
    keywords: ["switch branch", "checkout branch", "branch", "git branch"],
    actionId: ACTION_ID.SPOTLIGHT_OPEN_BRANCH_PICKER,
    payload: {},
    fallback: "branch-picker",
    closeOnSuccess: false,
  },
  {
    id: "add-workspace",
    labelKey: "selectors.spotlight.actions.addWorkspace.label",
    icon: FolderPlus,
    keywords: ["add workspace", "add repo", "add folder", "import workspace"],
    actionId: ACTION_ID.SPOTLIGHT_OPEN_WORKSPACE_PICKER,
    payload: { mode: "add" },
    fallback: "workspace-add",
    closeOnSuccess: false,
  },
  {
    id: "create-multi-repo-workspace",
    labelKey: "selectors.spotlight.actions.createMultiRepoWorkspace.label",
    icon: FolderTree,
    keywords: [
      "create workspace",
      "multi repo workspace",
      "Multi-repo Workspace",
      "workspace group",
    ],
    actionId: ACTION_ID.SPOTLIGHT_OPEN_WORKSPACE_PICKER,
    payload: { mode: "create" },
    fallback: "workspace-create",
    closeOnSuccess: false,
  },
] satisfies SpotlightStaticActionDefinition[];

export const EDITOR_ACTIONS = [
  {
    id: "go-to-editor-file",
    modeKey: "file",
    labelKey: "label",
    prefix: "",
    shortcut: getShortcutKeys("quick_open"),
  },
  {
    id: "run-editor-command",
    modeKey: "command",
    labelKey: "label",
    prefix: ">",
    shortcut: ">",
  },
  {
    id: "go-to-editor-symbol",
    modeKey: "symbol",
    labelKey: "label",
    prefix: "@",
    shortcut: getShortcutKeys("go_to_symbol"),
  },
] satisfies SpotlightEditorActionDefinition[];

export const QUICK_NAVIGATION_ACTIONS = [
  {
    id: "open-search-sidebar",
    labelKey: "selectors.spotlight.actions.searchInFiles.label",
    icon: Search,
    keywords: [
      "search files",
      "show search",
      "open search",
      "find in files",
      "code search",
      "code editor",
    ],
    shortcut: getShortcutKeys("search_files"),
    actionId: ACTION_ID.WORKSTATION_OPEN_SEARCH_SIDEBAR,
    payload: {},
    fallback: "open-search-sidebar",
    closeOnSuccess: true,
  },
  {
    id: "open-source-control-tab",
    labelKey: "selectors.spotlight.actions.showSourceControl.label",
    icon: GitPullRequest,
    keywords: [
      "source control",
      "show source control",
      "open source control",
      "git changes",
      "changes",
      "code editor",
    ],
    shortcut: getShortcutKeys("open_source_control_tab"),
    actionId: ACTION_ID.WORKSTATION_OPEN_SOURCE_CONTROL_TAB,
    payload: {},
    fallback: "open-source-control-tab",
    closeOnSuccess: true,
  },
  {
    id: "open-terminal-tab",
    labelKey: "selectors.spotlight.actions.showTerminal.label",
    icon: SquareTerminal,
    keywords: [
      "terminal",
      "show terminal",
      "open terminal",
      "shell",
      "command line",
      "code editor",
    ],
    shortcut: getShortcutKeys("open_terminal_tab"),
    actionId: ACTION_ID.WORKSTATION_OPEN_TERMINAL_TAB,
    payload: {},
    fallback: "open-terminal-tab",
    closeOnSuccess: true,
  },
] satisfies SpotlightStaticActionDefinition[];

// ============================================
// View action builder (state-dependent)
// ============================================

export function buildViewActions(
  isSidebarCollapsed: boolean,
  showWorkstationSidebarAction: boolean,
  showBottomPanelAction: boolean,
  showWorkStationChatFocusAction: boolean,
  isWorkstationSidebarCollapsed: boolean,
  isBottomPanelCollapsed: boolean,
  isChatPanelMaximized: boolean,
  isChatPanelVisible: boolean
): SpotlightStaticActionDefinition[] {
  const actions: SpotlightStaticActionDefinition[] = [
    {
      id: "toggle-sidebar",
      labelKey: isSidebarCollapsed
        ? "selectors.spotlight.actions.showAppSidebar.label"
        : "selectors.spotlight.actions.hideAppSidebar.label",
      icon: PanelLeft,
      keywords: [
        "show app sidebar",
        "hide app sidebar",
        "collapse app sidebar",
        "expand app sidebar",
        "app sidebar",
        "sidebar",
        "view",
      ],
      actionId: ACTION_ID.SIDEBAR_TOGGLE,
      payload: {},
      fallback: "toggle-sidebar",
      closeOnSuccess: true,
    },
  ];

  if (showWorkstationSidebarAction) {
    actions.push({
      id: "toggle-workstation-sidebar",
      labelKey: isWorkstationSidebarCollapsed
        ? "selectors.spotlight.actions.showWorkstationSidebar.label"
        : "selectors.spotlight.actions.hideWorkstationSidebar.label",
      icon: List,
      keywords: [
        "show work station sidebar",
        "hide work station sidebar",
        "collapse work station sidebar",
        "expand work station sidebar",
        "tool sidebar",
        "work station sidebar",
        "primary sidebar",
        "view",
      ],
      shortcut: getShortcutKeys("toggle_workstation_sidebar"),
      actionId: ACTION_ID.WORKSTATION_TOGGLE_SIDEBAR,
      payload: {},
      fallback: "toggle-workstation-sidebar",
      closeOnSuccess: true,
    });
  }

  if (showBottomPanelAction) {
    actions.push({
      id: "toggle-bottom-panel",
      labelKey: isBottomPanelCollapsed
        ? "commands.showBottomPanel"
        : "commands.hideBottomPanel",
      icon: PanelBottom,
      keywords: [
        "show bottom panel",
        "hide bottom panel",
        "toggle bottom panel",
        "terminal panel",
        "bottom panel",
        "view",
      ],
      shortcut: getShortcutKeys("toggle_bottom_panel"),
      actionId: ACTION_ID.PANEL_TOGGLE_BOTTOM,
      payload: {},
      fallback: "toggle-bottom-panel",
      closeOnSuccess: true,
    });
  }

  if (showWorkStationChatFocusAction) {
    actions.push({
      id: "toggle-workstation-chat-panel",
      labelKey: isChatPanelVisible
        ? "selectors.spotlight.actions.maximizeWorkStation.label"
        : "selectors.spotlight.actions.restoreChatPanel.label",
      icon: isChatPanelVisible ? Dock : MessageCircle,
      keywords: [
        "maximize work station",
        "hide chat panel",
        "restore chat panel",
        "show chat panel",
        "toggle chat panel",
        "work station",
        "view",
      ],
      shortcut: getShortcutKeys("maximize_work_station"),
      actionId: ACTION_ID.WORKSTATION_TOGGLE_CHAT_PANEL_VISIBILITY,
      payload: {},
      fallback: "toggle-chat-panel",
      closeOnSuccess: true,
    });

    actions.push({
      id: "toggle-workstation-chat-focus",
      labelKey: isChatPanelMaximized
        ? "selectors.spotlight.actions.showWorkstation.label"
        : "selectors.spotlight.actions.focusChatPanel.label",
      icon: isChatPanelMaximized ? Dock : MessageCircle,
      keywords: [
        "focus chat panel",
        "hide work station",
        "show work station",
        "restore work station",
        "chat panel",
        "workstation chat",
        "view",
      ],
      shortcut: getShortcutKeys("maximize_chat"),
      actionId: ACTION_ID.WORKSTATION_TOGGLE_CHAT_FOCUS,
      payload: {},
      fallback: "toggle-chat-focus",
      closeOnSuccess: true,
    });
  }

  actions.push(
    {
      id: "zoom-in",
      labelKey: "selectors.spotlight.actions.zoomIn.label",
      icon: ZoomIn,
      keywords: ["zoom in", "increase zoom", "increase UI scale", "view"],
      shortcut: getShortcutKeys("zoom_in"),
      actionId: ACTION_ID.APP_ZOOM_IN,
      payload: {},
      fallback: "zoom-in",
      closeOnSuccess: false,
    },
    {
      id: "zoom-out",
      labelKey: "selectors.spotlight.actions.zoomOut.label",
      icon: ZoomOut,
      keywords: ["zoom out", "decrease zoom", "decrease UI scale", "view"],
      shortcut: getShortcutKeys("zoom_out"),
      actionId: ACTION_ID.APP_ZOOM_OUT,
      payload: {},
      fallback: "zoom-out",
      closeOnSuccess: false,
    },
    {
      id: "zoom-reset",
      labelKey: "selectors.spotlight.actions.resetZoom.label",
      icon: RotateCcw,
      keywords: ["reset zoom", "reset UI scale", "actual size", "view"],
      shortcut: getShortcutKeys("zoom_reset"),
      actionId: ACTION_ID.APP_ZOOM_RESET,
      payload: {},
      fallback: "zoom-reset",
      closeOnSuccess: false,
    }
  );

  return actions;
}
