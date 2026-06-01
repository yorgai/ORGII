/**
 * Browser Simulator App Types
 *
 * Supports two subtools:
 * - browser: External browser (Playwright/CDP, Chrome) — screenshot display
 * - internal_browser: Internal browser (Tauri inline webview DOM automation)
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type { SimulatorAppBaseState } from "@src/engines/Simulator/apps/core/types";

// ============================================
// External Browser Subtool (Playwright/CDP)
// ============================================

export interface BrowserEntry {
  entryId: string;
  event: SessionEvent;
  url: string;
  title: string;
  subtitle?: string;
  timestamp: string;
  isCurrent: boolean;
}

// ============================================
// Internal Browser Subtool (Tauri webview DOM)
// ============================================

/** Action types for control_internal_browser tool */
export type InternalBrowserAction =
  | "get_state"
  | "click"
  | "input"
  | "select"
  | "scroll"
  | "show_mask"
  | "hide_mask"
  | "clean_up";

/** Entry representing a control_internal_browser tool call event */
export interface InternalBrowserEntry {
  entryId: string;
  event: SessionEvent;
  action: InternalBrowserAction;
  webviewLabel: string;
  timestamp: string;
  isCurrent: boolean;
  // Action-specific data
  index?: number;
  text?: string;
  option?: string;
  direction?: string;
  pages?: number;
  // Result data
  success?: boolean;
  message?: string;
}

// ============================================
// Combined State
// ============================================

export interface SimulatorBrowserState extends SimulatorAppBaseState {
  // External browser subtool (Playwright/CDP)
  browserEntries: BrowserEntry[];
  activeEntry: BrowserEntry | null;
  currentUrl: string | null;

  // Internal browser subtool
  internalBrowserEntries: InternalBrowserEntry[];
  activeInternalEntry: InternalBrowserEntry | null;
  activeWebview: string | null;
  isMaskShown: boolean;

  /** Which subtool the current/active event belongs to */
  activeSubtool: "browser" | "internal_browser" | null;
}
