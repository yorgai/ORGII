/**
 * Helpers for displaying tool names in the Agent Teams UI.
 *
 * The wire format for MCP tools is `mcp__<server>__<tool>`. Tables and
 * preview panels show the bare `<tool>` name; non-MCP tools pass through
 * unchanged. All read/write paths still use the fully-qualified `name`.
 */

const MCP_TOOL_PREFIX = "mcp__";

export function agentToolDisplayName(toolName: string): string {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return toolName;
  const rest = toolName.slice(MCP_TOOL_PREFIX.length);
  const sep = rest.indexOf("__");
  if (sep < 0) return toolName;
  return rest.slice(sep + 2);
}
