/**
 * WebDevTools Types
 *
 * Shared types for the WebDevTools components.
 */
import type { ElementInfo } from "@src/modules/WorkStation/Browser/hooks/useWebviewInspector";
import type { SecondaryPanelPosition } from "@src/store/ui/workStationAtom";

// ============================================
// Console Types
// ============================================

export type LogLevel = "log" | "warn" | "error" | "info" | "debug" | "trace";
export type FilterLevel = LogLevel | "all";

export interface ConsoleEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  url: string;
  stack?: string;
}

// ============================================
// Network Types
// ============================================

export interface NetworkEntry {
  id: string;
  type: "fetch" | "xhr";
  method: string;
  url: string;
  startTime: number;
  status: number | null;
  duration: number | null;
  size: string | null;
  error: string | null;
}

export type NetworkFilterStatus =
  | "all"
  | "2xx"
  | "3xx"
  | "4xx"
  | "5xx"
  | "failed";
export type NetworkFilterType = "all" | "fetch" | "xhr";

// ============================================
// Main Component Props
// ============================================

export interface WebDevToolsProps {
  /** Whether panel is visible */
  isOpen: boolean;
  /** Close the panel */
  onClose: () => void;
  /** Console log entries */
  entries: ConsoleEntry[];
  /** Clear all entries */
  onClearEntries: () => void;
  /** Network entries */
  networkEntries?: NetworkEntry[];
  /** Clear network entries */
  onClearNetworkEntries?: () => void;
  /** Panel width */
  width?: number;
  /** Callback when width changes (for resize) */
  onWidthChange?: (width: number) => void;
  /** Minimum panel width */
  minWidth?: number;
  /** Maximum panel width */
  maxWidth?: number;
  /** Preserve logs on navigation */
  preserveLogs?: boolean;
  /** Toggle preserve logs */
  onTogglePreserveLogs?: () => void;
  /** Selected element from inspector */
  selectedElement?: ElementInfo | null;
  /** Webview label for DOM tree and style editing */
  webviewLabel?: string;
  /** Repository path for source navigation */
  repoPath?: string;
  /** Current page URL (triggers DOM refresh when changed) */
  currentUrl?: string;
  /** Position of the DevTools panel (right or bottom) */
  position?: SecondaryPanelPosition;
  /** Toggle the panel position between right and bottom */
  onTogglePosition?: () => void;
}

// ============================================
// Tab Types
// ============================================

export type DevToolsTab = "elements" | "console" | "network";
export type ComponentsSubTab = "design" | "css" | "source";
