/**
 * Interactive Tools Registry — single source of truth for tools whose
 * `execute()` blocks the agent turn awaiting user input.
 *
 * Keep aligned with the Rust-side `INTERACTIVE_TOOL_NAMES` in
 * `src-tauri/src/agent_core/core/tools/interactive.rs`. These tools use the
 * `awaiting_user` display status so generic "complete the last running
 * event" paths don't prematurely flip them to `completed`.
 */

/**
 * Canonical names of tools that block the agent turn awaiting user input.
 *
 * When a tool is in this list:
 *   - Its tool_call event is created with `displayStatus: "awaiting_user"`.
 *   - `eventStoreProxy.completeLastRunning()` skips it.
 *   - Only `agent:interaction_finalized` (via `mergeEvents`) transitions it
 *     to `completed`.
 */
export const INTERACTIVE_TOOL_NAMES = [
  "ask_user_questions",
  "ask_user_permissions",
  "suggest_mode_switch",
  "create_plan",
] as const;

export type InteractiveToolName = (typeof INTERACTIVE_TOOL_NAMES)[number];

/**
 * MCP-prefixed variants of interactive tools.
 *
 * When the agent calls a built-in interactive tool via the MCP bridge the
 * function name arrives with an "mcp_orgii_" prefix
 * (e.g. "mcp_orgii_suggest_mode_switch"). The prefix is an implementation
 * detail of the MCP routing layer and must not change the interactive-tool
 * semantics (awaiting_user status, skip completeLastRunning, etc.).
 */
const MCP_PREFIX = "mcp_orgii_";

/**
 * Strip the MCP prefix from a tool name if present.
 * "mcp_orgii_suggest_mode_switch" → "suggest_mode_switch"
 * "suggest_mode_switch"           → "suggest_mode_switch"
 */
export function stripMcpPrefix(toolName: string): string {
  return toolName.startsWith(MCP_PREFIX)
    ? toolName.slice(MCP_PREFIX.length)
    : toolName;
}

/**
 * Returns `true` if `toolName` is an interactive tool that blocks the agent
 * turn awaiting user input.
 *
 * Matches both the canonical name ("suggest_mode_switch") and the MCP-prefixed
 * variant ("mcp_orgii_suggest_mode_switch") so that MCP-routed interactive
 * tool calls receive the correct `awaiting_user` display status and are not
 * prematurely completed by `completeLastRunning()`.
 */
export function isInteractiveTool(
  toolName: string | undefined | null
): toolName is InteractiveToolName {
  if (!toolName) return false;
  const canonical = stripMcpPrefix(toolName);
  return (INTERACTIVE_TOOL_NAMES as readonly string[]).includes(canonical);
}
