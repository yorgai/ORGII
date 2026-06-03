/**
 * Tool Categories
 *
 * Unified tool type detection based on Rust registry data.
 * This replaces scattered hardcoded tool name checks across the codebase.
 *
 * Categories are derived from:
 * 1. Rust's appSubtool mapping (preferred - data-driven)
 * 2. UI canonical names (fallback for chat grouping)
 */
import { TOOL_NAMES } from "@src/api/tauri/agent/toolNames";

import { getAppSubtool, getCliUiCanonical } from "./initToolRegistry";

// ============================================
// Event Category (for UI grouping in chat)
// ============================================

export type EventCategory =
  | "file"
  | "terminal"
  | "explore"
  | "conversation"
  | "browser"
  | "code-nav"
  | "approval"
  | "other";

/** UI canonical names that map to file category */
const FILE_UI_CANONICALS = new Set([
  "read_file",
  "edit_file",
  "delete_file",
  "list_dir",
]);

/** UI canonical names that map to search category */
const SEARCH_UI_CANONICALS = new Set([
  "code_search",
  "web_search",
  "glob_file_search",
]);

/** UI canonical names that map to conversation category */
const CONVERSATION_UI_CANONICALS = new Set([
  "agent_message",
  "thinking",
  "user",
  "ask_user_questions",
]);

/**
 * Get event category for UI grouping in chat.
 * Uses UI canonical name for consistency with component loading.
 */
export function getCategoryForUiCanonical(uiCanonical: string): EventCategory {
  if (FILE_UI_CANONICALS.has(uiCanonical)) return "file";
  if (
    uiCanonical === "run_shell" ||
    uiCanonical === "await_output" ||
    uiCanonical === "inspect_terminals"
  )
    return "terminal";
  if (SEARCH_UI_CANONICALS.has(uiCanonical)) return "explore";
  if (CONVERSATION_UI_CANONICALS.has(uiCanonical)) return "conversation";
  if (uiCanonical === "ask_user_permissions") return "approval";
  if (
    uiCanonical === "control_browser_with_agent_browser" ||
    uiCanonical === "control_browser_with_playwright" ||
    uiCanonical === "control_external_browser" ||
    uiCanonical === "control_internal_browser"
  ) {
    return "browser";
  }
  return "other";
}

// ============================================
// Tool Type Detection (based on appSubtool)
// ============================================

/**
 * Check if a tool is a browser-related tool.
 * Uses Rust appSubtool mapping for accuracy.
 */
export function isBrowserTool(toolName: string): boolean {
  const subtool = getAppSubtool(toolName);
  if (subtool === "browser" || subtool === "internal_browser") {
    return true;
  }
  // Fallback: check prefix for unknown tools
  return toolName.startsWith("browser_");
}

/**
 * Check if a tool is a search-related tool (content search, glob, explore).
 * Uses Rust appSubtool mapping for accuracy.
 */
export function isSearchTool(toolName: string): boolean {
  const subtool = getAppSubtool(toolName);
  if (subtool === "explore" || subtool === "search" || subtool === "glob") {
    return true;
  }
  const uiCanonical = getCliUiCanonical(toolName);
  return SEARCH_UI_CANONICALS.has(uiCanonical);
}

/**
 * Check if a tool is a file-related tool.
 * Uses Rust appSubtool mapping for accuracy.
 */
export function isFileTool(toolName: string): boolean {
  const subtool = getAppSubtool(toolName);
  if (subtool === "file_read" || subtool === "file_write") {
    return true;
  }
  // Fallback: check UI canonical for CLI tools
  const uiCanonical = getCliUiCanonical(toolName);
  return FILE_UI_CANONICALS.has(uiCanonical);
}

/**
 * Check if a tool is a shell/terminal command tool.
 * Uses Rust appSubtool mapping for accuracy.
 */
export function isShellTool(toolName: string): boolean {
  const subtool = getAppSubtool(toolName);
  if (subtool === "shell") {
    return true;
  }
  // Fallback: check UI canonical
  const uiCanonical = getCliUiCanonical(toolName);
  return uiCanonical === "run_shell";
}

/**
 * Check if a tool is a message/conversation tool.
 */
export function isMessageTool(toolName: string): boolean {
  const subtool = getAppSubtool(toolName);
  if (subtool === "message") {
    return true;
  }
  const uiCanonical = getCliUiCanonical(toolName);
  return CONVERSATION_UI_CANONICALS.has(uiCanonical);
}

// ============================================
// Display Helpers
// ============================================

/**
 * Tools that have custom styled output rendering.
 * Used to determine if raw args should be hidden in ToolCallBlock.
 * query_lsp is excluded: it's classified as explore but outputs plain text,
 * not structured search results, so it needs to show raw args.
 */
const RICH_CARD_TOOLS = new Set([
  "write_file",
  "web_fetch",
  TOOL_NAMES.ORG_SEND_MESSAGE,
]);

export function hasStyledOutput(toolName: string): boolean {
  const subtool = getAppSubtool(toolName);
  if (subtool === "project") return true;
  if (subtool === "shell") return true;
  if (subtool === "other_tool") {
    return toolName === "manage_workspace" || toolName === "await_output";
  }
  if (toolName === "query_lsp") return false;
  if (RICH_CARD_TOOLS.has(toolName)) return true;
  if (isBrowserTool(toolName)) return true;
  return (
    isSearchTool(toolName) ||
    toolName === "manage_story_list" ||
    toolName === "manage_workspace" ||
    toolName === "await_output"
  );
}

// ============================================
// Activity Summary Categories (for chat grouping)
// ============================================

export type ActivitySummaryCategory =
  | "read"
  | "search"
  | "list"
  | "glob"
  | "lsp";

/** Mapping from tool names (both UI canonical and Rust raw) to activity summary category */
const SUMMARY_CATEGORY_MAP: Record<string, ActivitySummaryCategory> = {
  read_file: "read",
  code_search: "search",
  search_in_file: "search",
  glob_file_search: "glob",
  list_dir: "list",
  query_lsp: "lsp",
};

/**
 * Classify an activity into a summary category for chat pipeline grouping.
 * Returns null if the activity is not an exploration/lookup action.
 *
 * Checks both the raw name and its UI canonical alias so Rust-native tool
 * names (e.g. `code_search`) and CLI aliases both resolve correctly.
 */
export function getActivitySummaryCategory(
  actionType?: string,
  functionName?: string
): ActivitySummaryCategory | null {
  const candidates = [functionName, actionType].filter(
    (value): value is string => Boolean(value)
  );

  for (const candidate of candidates) {
    const direct = SUMMARY_CATEGORY_MAP[candidate];
    if (direct) return direct;

    const uiCanonical = getCliUiCanonical(candidate);
    if (uiCanonical !== candidate) {
      const resolved = SUMMARY_CATEGORY_MAP[uiCanonical];
      if (resolved) return resolved;
    }
  }

  return null;
}
