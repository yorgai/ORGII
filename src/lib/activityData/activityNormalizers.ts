/**
 * Activity Data Normalizers — GENERAL PURPOSE LAYER
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  PURPOSE                                                                │
 * │                                                                         │
 * │  General-purpose normalization for activity data consumers:            │
 * │  • Chat panel components                                               │
 * │  • External integrations                                               │
 * │  • Analytics and reporting                                             │
 * │                                                                         │
 * │  NOT for ingestion — use ingestion/normalizers.ts for that.            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * KEY FUNCTIONS:
 * - normalizeActivity(): Any activity format → NormalizedActivityResult
 * - normalizeFunctionName(): Returns UI canonical (coarse grouping)
 * - getRegistryEventType(): Resolve event type for component registry lookup
 *
 * VS ingestion/normalizers.ts:
 * - This file: UI canonical names (edit_file, shell, search)
 * - Ingestion: Storage canonical names (str_replace_editor, bash, grep)
 *
 * Source of truth: Rust tool registry (cli_agents/alias_map.rs)
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { getCliUiCanonical } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import { resolveToolName } from "@src/engines/SessionCore/rendering/registry/toolAliases";
import { createLogger } from "@src/hooks/logger";

import type { ActivityArgs, ActivityResult } from "./types";

const log = createLogger("normalizeActivity");

/** Output of normalizeActivity() — lightweight struct for callers */
export interface NormalizedActivityResult {
  actionType: string;
  functionName: string;
  args: ActivityArgs;
  result: ActivityResult;
  createdAt: string;
}

// ============================================
// Action Type Mappings (Consolidated)
// ============================================

/**
 * Map backend action_type to normalized frontend type
 * Consolidates: ACTION_TYPE_NORMALIZE, ACTION_TO_FUNCTION_MAP
 */
const ACTION_TYPE_MAP: Record<string, string> = {
  // Tool calls
  tool_call: "tool_call",
  raw_event: "tool_call",
  raw: "tool_call",

  // Thinking
  thinking: "thinking",
  llm_thinking: "thinking",
  Thinking: "thinking",
  THINKING: "thinking",

  // Assistant/Agent messages
  assistant: "assistant",
  message: "assistant",
  agent_response: "assistant",
  Assistant: "assistant",
  ASSISTANT: "assistant",

  // Errors
  error: "error",

  // Git operations
  git_commit: "git_commit",
  git_push: "git_push",
  create_pull_request: "create_pull_request",
  GitCommit: "git_commit",
  GitPush: "git_push",
  CreatePullRequest: "create_pull_request",
  create_pr: "create_pull_request",

  // Real-time streaming events
  message_delta: "message_delta",
  thinking_delta: "thinking_delta",
  tool_call_start: "tool_call_start",
  tool_call_update: "tool_call_update",
  tool_call_end: "tool_call_end",
  MessageDelta: "message_delta",
  ThinkingDelta: "thinking_delta",
  ToolCallStart: "tool_call_start",
  ToolCallUpdate: "tool_call_update",
  ToolCallEnd: "tool_call_end",

  // Plan & Approval
  plan_update: "plan_update",
  approval_request: "ask_user_permissions",
  ask_user_permissions: "ask_user_permissions",
  approval_response: "approval_response",
  PlanUpdate: "plan_update",
  ApprovalRequest: "ask_user_permissions",
  ApprovalResponse: "approval_response",

  // Ask user questions
  ask_user: "ask_user_questions",
  ask_user_questions: "ask_user_questions",
};

// FUNCTION_NAME_MAP removed — normalizeFunctionName now delegates to
// cliAgents/toolAliasMap.ts (Rust source of truth via cli_agents/alias_map.rs)

// ============================================
// Helper Functions
// ============================================

/**
 * Normalize action type to standard form
 */
function normalizeActionType(type: string): string {
  return ACTION_TYPE_MAP[type] || type.toLowerCase();
}

/**
 * Normalize function name to standard form for UI component mapping.
 * Delegates to cliAgents/toolAliasMap (Rust source of truth).
 * Returns ui_canonical (coarse grouping, e.g., "edit_file" for all edit operations).
 */
export function normalizeFunctionName(func: string): string {
  // getCliUiCanonical returns the alias itself if not found (passthrough)
  return getCliUiCanonical(func);
}

// ============================================
// Main Normalization Function
// ============================================

const EMPTY_RESULT: NormalizedActivityResult = {
  actionType: "unknown",
  functionName: "",
  args: {},
  result: {},
  createdAt: "",
};

/**
 * Normalize any activity event format to a consistent structure.
 *
 * Extracts and normalizes: actionType, functionName, args, result, createdAt.
 * Status mapping is handled downstream by propsNormalizer's mapStatus().
 */
export function normalizeActivity(
  event: Record<string, unknown>
): NormalizedActivityResult {
  if (!event) {
    if (process.env.NODE_ENV === "development") {
      log.warn(
        "[normalizeActivity] Received undefined/null event, returning defaults"
      );
    }
    return EMPTY_RESULT;
  }

  const eventObj = event as Record<string, unknown>;
  const activityData = eventObj.activityData as Record<string, unknown>;

  // Action type
  const rawActionType =
    (eventObj.actionType as string) ||
    (activityData?.action_type as string) ||
    (eventObj.action_type as string) ||
    (eventObj.type as string) ||
    "tool_call";
  const actionType = normalizeActionType(rawActionType);

  // Function name — prefer pre-computed uiCanonical from Rust
  const precomputedUiCanonical =
    (eventObj.uiCanonical as string) || (activityData?.ui_canonical as string);
  const rawFunctionName =
    (eventObj.functionName as string) ||
    (activityData?.function as string) ||
    (eventObj.function as string) ||
    (eventObj.text as string) ||
    "";
  const functionName =
    precomputedUiCanonical || normalizeFunctionName(rawFunctionName);

  // Args and result
  const args = ((activityData?.args as ActivityArgs) ||
    (eventObj.args as ActivityArgs) ||
    {}) as ActivityArgs;
  const result = ((activityData?.result as ActivityResult) ||
    (eventObj.result as ActivityResult) ||
    {}) as ActivityResult;

  // Timestamp
  const createdAt =
    (eventObj.createdAt as string) ||
    (activityData?.created_at as string) ||
    (eventObj.created_at as string) ||
    (eventObj.created_time as string) ||
    "";

  return { actionType, functionName, args, result, createdAt };
}

/**
 * Get the appropriate event type for registry lookup.
 *
 * Prefers `uiCanonical` (pre-computed in Rust) when available on the event,
 * falling back to runtime resolution for legacy/untyped events.
 *
 * Accepts `SessionEvent` or a loose record (simulator / tests).
 */
export function getRegistryEventType(
  event: SessionEvent | Record<string, unknown>
): string {
  const record = event as Record<string, unknown>;
  // Fast path: Rust pre-computed uiCanonical
  const uiCanonical = record.uiCanonical as string | undefined;
  if (uiCanonical) {
    // MCP server tools still need runtime detection via args.server
    const args = (record.args ?? {}) as Record<string, unknown>;
    if (args.server && typeof args.server === "string") {
      return "mcp_tool";
    }
    return uiCanonical;
  }

  // Fallback: runtime normalization for events without uiCanonical
  const normalized = normalizeActivity(record);

  if (normalized.args.server && typeof normalized.args.server === "string") {
    return "mcp_tool";
  }

  if (normalized.actionType === "tool_call") {
    const name = normalized.functionName || "tool_call";
    return resolveToolName(name);
  }

  const resolved = resolveToolName(
    normalized.actionType || normalized.functionName || "tool_call"
  );
  return resolved;
}
