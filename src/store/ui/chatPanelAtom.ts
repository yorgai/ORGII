import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import {
  MAX_WIDTH as CHAT_MAX_WIDTH,
  MIN_WIDTH as CHAT_MIN_WIDTH,
} from "@src/engines/ChatPanel/config";
import {
  settingsAtom,
  updateSettingAtom,
} from "@src/store/settings/settingsAtom";
import type { Project } from "@src/types/core/project";
import type { WorkItem } from "@src/types/core/workItem";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

// ============================================
// Chat Panel Layout Atoms
// ============================================
// High-frequency state atoms for chat panel dimensions and visibility.
// Use Jotai instead of Context to avoid excessive re-rendering.

/**
 * Chat width - persisted across sessions
 * Now unified across all views (workstation, session workspace, kanban)
 *
 * OPTIMIZED: Uses debounced localStorage writes to prevent blocking UI
 */

// Debounce timer for localStorage writes
export const DEFAULT_CHAT_WIDTH = 520;

let chatWidthSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastVisibleChatWidth = DEFAULT_CHAT_WIDTH;
const CHAT_WIDTH_SAVE_DELAY = 300; // ms

// CSS variable name for direct DOM updates
const CHAT_WIDTH_CSS_VAR = "--orgii-chat-width";
// Clamp persisted widths to [MIN_WIDTH, MAX_WIDTH]; preserve the 0
// sentinel which means "chat panel hidden".
const ChatWidthSchema = z.number().transform((value) => {
  if (value <= 0) return 0;
  return Math.min(Math.max(value, CHAT_MIN_WIDTH), CHAT_MAX_WIDTH);
});
const StationChatVisibilitySchema = z.object({
  "my-station": z.boolean(),
  "agent-station": z.boolean(),
});

export type StationChatVisibility = z.infer<typeof StationChatVisibilitySchema>;
export type ChatStationMode = keyof StationChatVisibility;

// Load initial value from localStorage (only once at startup).
// Clamp to MAX_WIDTH so values persisted from wider viewports don't overflow,
// and immediately write the clamped value back so the next reload is clean.
const getInitialChatWidth = (): number => {
  if (typeof window === "undefined") return DEFAULT_CHAT_WIDTH;
  try {
    const storedValue = localStorage.getItem("globalChatWidth");
    const parsed =
      storedValue !== null ? JSON.parse(storedValue) : DEFAULT_CHAT_WIDTH;
    const width = ChatWidthSchema.safeParse(parsed).data ?? DEFAULT_CHAT_WIDTH;
    if (width !== parsed) {
      localStorage.setItem("globalChatWidth", JSON.stringify(width));
    }
    return width;
  } catch {
    localStorage.setItem("globalChatWidth", JSON.stringify(DEFAULT_CHAT_WIDTH));
    return DEFAULT_CHAT_WIDTH;
  }
};

// Initialize CSS variable on module load (before any component renders)
const initialChatWidth = getInitialChatWidth();
lastVisibleChatWidth =
  initialChatWidth > 0 ? initialChatWidth : DEFAULT_CHAT_WIDTH;
if (typeof document !== "undefined") {
  document.documentElement.style.setProperty(
    CHAT_WIDTH_CSS_VAR,
    `${initialChatWidth}px`
  );
}

// Base atom for in-memory state (fast updates, no persistence)
const chatWidthBaseAtom = atom<number>(initialChatWidth);
chatWidthBaseAtom.debugLabel = "chatWidthBaseAtom";

/**
 * Chat width atom with optimized persistence
 * - Reads from base atom (fast)
 * - Writes update base atom immediately + debounced localStorage write
 * - Also updates CSS variable directly for instant visual feedback
 */
export const chatWidthAtom = atom(
  (get) => get(chatWidthBaseAtom),
  (_get, set, newWidth: number) => {
    const clampedWidth =
      newWidth > 0 ? Math.min(newWidth, CHAT_MAX_WIDTH) : newWidth;

    set(chatWidthBaseAtom, clampedWidth);

    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty(
        CHAT_WIDTH_CSS_VAR,
        `${clampedWidth}px`
      );
    }

    if (clampedWidth <= 0) return;

    lastVisibleChatWidth = clampedWidth;
    if (chatWidthSaveTimer) {
      clearTimeout(chatWidthSaveTimer);
    }
    chatWidthSaveTimer = setTimeout(() => {
      localStorage.setItem("globalChatWidth", JSON.stringify(clampedWidth));
      chatWidthSaveTimer = null;
    }, CHAT_WIDTH_SAVE_DELAY);
  }
);
chatWidthAtom.debugLabel = "chatWidthAtom";

export const restoreChatWidthAtom = atom(null, (_get, set) => {
  set(chatWidthAtom, lastVisibleChatWidth || DEFAULT_CHAT_WIDTH);
});
restoreChatWidthAtom.debugLabel = "restoreChatWidthAtom";

/**
 * Derived atom for chat visibility only
 * OPTIMIZED: Only triggers re-render when visibility changes (0 <-> non-zero)
 * Components that only need to know if chat is visible should use this
 */
export const chatVisibleAtom = atom((get) => get(chatWidthBaseAtom) > 0);
chatVisibleAtom.debugLabel = "chatVisibleAtom";

export const stationChatVisibilityAtom = atomWithStorage<StationChatVisibility>(
  "stationChatVisibility",
  {
    "my-station": true,
    "agent-station": true,
  },
  createZodJsonStorage(StationChatVisibilitySchema),
  { getOnInit: true }
);
stationChatVisibilityAtom.debugLabel = "stationChatVisibilityAtom";

export const activeStationChatVisibleAtom = atom(
  (get) => (mode: ChatStationMode) => get(stationChatVisibilityAtom)[mode],
  (_get, set, mode: ChatStationMode, visible: boolean) => {
    set(stationChatVisibilityAtom, (prev) => ({
      ...prev,
      [mode]: visible,
    }));
    if (visible) {
      set(restoreChatWidthAtom);
    } else {
      set(chatWidthAtom, 0);
    }
  }
);
activeStationChatVisibleAtom.debugLabel = "activeStationChatVisibleAtom";

/**
 * Per-session opt-in for the Agent Org group chat view. Holds the
 * coordinator session id whose ChatPanel is currently rendering the
 * group view (or `null` for none). Non-persistent: closing or
 * switching session reverts to the per-member ChatHistory default,
 * matching the user's preference that the dropdown choice not stick.
 *
 * Stored as a single-id atom (not a `Set`) because exactly one chat
 * panel surface is active at a time — secondary surfaces (kanban
 * detail, project manager tab) render a different `ChatView` instance
 * and should not inherit the parent's group-view selection.
 */
export const groupChatViewSessionIdAtom = atom<string | null>(null);
groupChatViewSessionIdAtom.debugLabel = "groupChatViewSessionIdAtom";

/** Whether chat history is displayed as turn-based rounds. */
export const chatTurnPaginationEnabledAtom = atom(
  (get) => get(settingsAtom)["general.chatTurnPaginationEnabled"] as boolean,
  (_get, set, value: boolean) => {
    set(updateSettingAtom, {
      key: "general.chatTurnPaginationEnabled",
      value,
    });
  }
);
chatTurnPaginationEnabledAtom.debugLabel = "chatTurnPaginationEnabledAtom";

/** Presentation style for the chat panel model picker. */
export type ModelPickerStyle = "spotlight" | "dropdown";

/**
 * Whether the chat panel model pill opens the full Spotlight palette
 * (`"spotlight"`) or a compact anchored dropdown (`"dropdown"`).
 */
export const modelPickerStyleAtom = atom(
  (get) => get(settingsAtom)["general.modelPickerStyle"] as ModelPickerStyle,
  (_get, set, value: ModelPickerStyle) => {
    set(updateSettingAtom, {
      key: "general.modelPickerStyle",
      value,
    });
  }
);
modelPickerStyleAtom.debugLabel = "modelPickerStyleAtom";

// ============================================
// Chat Panel Slot Mode / Maximized
// ============================================
//
// The docked chat-panel slot can host either the live session view or
// Settings. Which one occupies the slot is fully URL-derived (any
// `/orgii/app/settings/*` path → Settings; otherwise → session), so
// there is no atom for it — `AppLayout`/`AppShell` compute the mode
// directly from `useLocation()` and pass it down. The only persistent
// axis is "maximized", which is orthogonal to the mode and survives
// reloads.

/**
 * What content occupies the chat-panel slot. Derived from the URL by
 * the layout shell; this type is exported only as a wire format for the
 * shell → layout prop hand-off.
 */
export type ChatPanelMode = "session" | "settings";

export const CHAT_PANEL_CREATE_TARGET = {
  AGENT_SESSION: "agentSession",
  CREATE_AGENT: "createAgent",
  PROJECT: "project",
  WORK_ITEM: "workItem",
  BENCHMARK: "benchmark",
} as const;

export type ChatPanelCreateTarget =
  (typeof CHAT_PANEL_CREATE_TARGET)[keyof typeof CHAT_PANEL_CREATE_TARGET];

export const DEFAULT_CHAT_PANEL_CREATE_TARGET: ChatPanelCreateTarget =
  CHAT_PANEL_CREATE_TARGET.AGENT_SESSION;

export const chatPanelCreateTargetAtom = atom<ChatPanelCreateTarget>(
  DEFAULT_CHAT_PANEL_CREATE_TARGET
);
chatPanelCreateTargetAtom.debugLabel = "chatPanelCreateTargetAtom";

export const CHAT_PANEL_CONTENT_MODE = {
  SESSION: "session",
  NON_SESSION: "nonSession",
  BENCHMARK_SESSION_GROUP: "benchmarkSessionGroup",
} as const;

export type ChatPanelContentMode =
  (typeof CHAT_PANEL_CONTENT_MODE)[keyof typeof CHAT_PANEL_CONTENT_MODE];

export const chatPanelContentModeAtom = atom<ChatPanelContentMode>(
  CHAT_PANEL_CONTENT_MODE.SESSION
);
chatPanelContentModeAtom.debugLabel = "chatPanelContentModeAtom";

export interface ChatPanelSelectedWorkItem {
  workItem: WorkItem;
  projectId: string;
  projectName: string;
  projectSlug: string;
  shortId: string;
}

export const chatPanelSelectedWorkItemAtom =
  atom<ChatPanelSelectedWorkItem | null>(null);
chatPanelSelectedWorkItemAtom.debugLabel = "chatPanelSelectedWorkItemAtom";

export interface ChatPanelSelectedProject {
  project: Project;
  projectSlug: string;
  orgId: string;
  orgName?: string;
}

export const chatPanelSelectedProjectAtom =
  atom<ChatPanelSelectedProject | null>(null);
chatPanelSelectedProjectAtom.debugLabel = "chatPanelSelectedProjectAtom";

export interface ChatPanelSelectedWorkspace {
  kind: "workspace" | "repo";
  id: string;
  name: string;
  path?: string;
  folderCount?: number;
  repoIds?: string[];
}

export const chatPanelSelectedWorkspaceAtom =
  atom<ChatPanelSelectedWorkspace | null>(null);
chatPanelSelectedWorkspaceAtom.debugLabel = "chatPanelSelectedWorkspaceAtom";

export const chatPanelWorkspaceDashboardOpenAtom = atom<boolean>(false);
chatPanelWorkspaceDashboardOpenAtom.debugLabel =
  "chatPanelWorkspaceDashboardOpenAtom";

/**
 * Whether the chat-panel slot is rendering the full-page Sticky Notes
 * board. Mutually exclusive with WorkItem/Project at the render layer
 * (precedence enforced in ChatPanel/index.tsx) — entry points must
 * clear sibling atoms when flipping this on.
 */
export const chatPanelStickyNotesOpenAtom = atom<boolean>(false);
chatPanelStickyNotesOpenAtom.debugLabel = "chatPanelStickyNotesOpenAtom";

export interface ChatPanelCreateProjectContext {
  orgId: string;
  scopeBreadcrumbLabel?: string;
}

export const chatPanelCreateProjectContextAtom =
  atom<ChatPanelCreateProjectContext | null>(null);
chatPanelCreateProjectContextAtom.debugLabel =
  "chatPanelCreateProjectContextAtom";

/**
 * Whether the chat-panel slot covers the entire main content area.
 * Maximizing is purely a slot-side affordance; the underlying station
 * mode never changes, so un-maximize requires no bookkeeping. Persisted
 * so a maximized layout survives reloads.
 */
export const chatPanelMaximizedAtom = atomWithStorage<boolean>(
  "orgii:chatPanelMaximized",
  false,
  createZodJsonStorage(z.boolean()),
  { getOnInit: true }
);
chatPanelMaximizedAtom.debugLabel = "chatPanelMaximizedAtom";

/** Write-only toggle for the maximized state. */
export const toggleChatPanelMaximizedAtom = atom(null, (get, set) => {
  set(chatPanelMaximizedAtom, !get(chatPanelMaximizedAtom));
});
toggleChatPanelMaximizedAtom.debugLabel = "toggleChatPanelMaximizedAtom";

// ============================================
// Replay Slider Atoms
// ============================================

/**
 * Replay display value while dragging
 * High frequency updates, does not trigger Context re-render
 */
export const replayDisplayValueAtom = atom<number>(200);
replayDisplayValueAtom.debugLabel = "replayDisplayValueAtom";

/**
 * Whether Replay is currently being dragged
 */
export const replayIsDraggingAtom = atom<boolean>(false);
replayIsDraggingAtom.debugLabel = "replayIsDraggingAtom";

// ============================================
// Chat Panel Visibility / Read-Only
// ============================================

/** Whether the chat-related dropdown UI is open */
export const chatDropDownShowAtom = atom<boolean>(false);
chatDropDownShowAtom.debugLabel = "chatDropDownShowAtom";

/** Whether the chat panel / workspace is in read-only mode */
export const wpReadOnlyAtom = atom<boolean>(true);
wpReadOnlyAtom.debugLabel = "wpReadOnlyAtom";
