/**
 * Chat Item Pipeline — Activity Classifiers
 *
 * Simple boolean identity checks: "is this event a browser action?", etc.
 * These are used by the main pipeline to decide which buffer an event goes into.
 *
 * Uses `event.uiCanonical` (pre-computed in Rust) for fast lookups.
 * Falls back to normalizeFunctionName() for events without uiCanonical.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  getBuiltinSimulatorApp,
  getCliSimulatorApp,
} from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import { getActivitySummaryCategory } from "@src/engines/SessionCore/rendering/registry/toolCategories";
import { normalizeFunctionName } from "@src/lib/activityData/activityNormalizers";

/**
 * Get UI canonical name from a SessionEvent.
 * Prefers pre-computed uiCanonical, falls back to runtime normalization.
 */
function getUiCanonical(event: SessionEvent): string {
  if (event.uiCanonical) return event.uiCanonical;
  return normalizeFunctionName(event.functionName || event.actionType || "");
}

// ============================================
// Action Summary Categories
// ============================================

export type ActionSummaryCategory = "read" | "search" | "list" | "glob" | "lsp";

/**
 * Classify an event into an action summary category.
 * Returns null if the event is not an exploration/lookup action.
 */
export function getActionSummaryCategory(
  event: SessionEvent
): ActionSummaryCategory | null {
  return getActivitySummaryCategory(event.actionType, event.functionName);
}

/**
 * Check if an event is a read file action.
 */
export const isReadFileEvent = (event: SessionEvent): boolean => {
  return getUiCanonical(event) === "read_file";
};

/**
 * Get the simulator app type for a tool (Rust source of truth).
 */
export function getToolSimulatorApp(
  rawName: string,
  normalizedName?: string
): string | null {
  const cliApp = getCliSimulatorApp(rawName);
  if (cliApp) return cliApp;

  const nameToCheck = normalizedName ?? rawName;
  const builtinApp = getBuiltinSimulatorApp(nameToCheck);
  if (builtinApp) return builtinApp;

  return null;
}

/**
 * Check if an event routes to a specific simulator app type.
 */
export function isEventInSimulatorApp(
  event: SessionEvent,
  appType: string
): boolean {
  const rawName = event.functionName || event.actionType || "";
  const normalized = getUiCanonical(event);
  const toolApp = getToolSimulatorApp(rawName, normalized);
  return toolApp === appType;
}

/**
 * Check if an event is a browser tool call.
 */
export const isBrowserEvent = (event: SessionEvent): boolean => {
  const isToolCallAction =
    event.actionType === "tool_call" ||
    event.actionType === "tool_call_start" ||
    event.actionType === "tool_call_update";

  return isToolCallAction && isEventInSimulatorApp(event, "BROWSER");
};

/**
 * Check if an event is a manage_todo event.
 */
export const isManageTodoEvent = (event: SessionEvent): boolean => {
  return getUiCanonical(event) === "manage_todo";
};

/**
 * Terminal agent-error event (quota exhausted, rate limited, auth failure,
 * stream retry budget exhausted, …).
 *
 * SINGLE SOURCE OF TRUTH for "is this event an error card". Matches the
 * shape stamped by both producers:
 * - Rust `lifecycle::build_session_error_event` (id `session-error-…`)
 * - FE `makeErrorEvent` in sync/adapters/shared/eventFactories.ts
 *
 * Mirrors Claude Code's `isApiErrorMessage` contract: every render,
 * filter, and collapse path must treat these as always-visible — a
 * failed turn whose error card is dropped renders as blank space
 * (the 2026-06-10 quota-error bug). Consumers: ActivityRouter (renders
 * AgentErrorChatItem), useChatGroups (collapse survivor set).
 */
export const isAgentErrorEvent = (event: SessionEvent): boolean => {
  return (
    event.functionName === "system" &&
    event.displayStatus === "failed" &&
    event.displayVariant === "message"
  );
};
