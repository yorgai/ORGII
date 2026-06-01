/**
 * Domain-specific tool classification helpers.
 * Extracted from initToolRegistry.ts to stay within the 500-line config file limit.
 */
import { getAppSubtool, getCliStorageCanonical } from "./initToolRegistry";

// ============================================
// IDE event type mapping
// ============================================

/**
 * Map a functionName to the IDE's simplified event type.
 * Used by SimulatorIDE to derive the event type when not passed as a prop.
 */
export function getIDEEventType(
  functionName: string
): "read" | "write" | "shell" | "explore" | "tool" {
  const subtool = getAppSubtool(functionName);
  switch (subtool) {
    case "file_write":
      return "write";
    case "shell":
      return "shell";
    case "explore":
    case "search":
    case "glob":
      return "explore";
    case "file_read":
      return "read";
    case "other_tool":
      return "tool";
    default:
      return "read";
  }
}

// ============================================
// Delete tool detection
// ============================================

const DELETE_CANONICAL_NAMES = new Set([
  "delete_file",
  "Delete",
  "delete",
  "deleteToolCall",
  "remove_file",
]);

/**
 * Check whether `functionName` represents a file-delete tool.
 * Uses both the builtin/CLI alias canonical name and a static allowlist
 * so that all call-sites share one source of truth.
 */
export function isDeleteTool(functionName: string): boolean {
  if (getAppSubtool(functionName) !== "file_write") return false;
  return (
    DELETE_CANONICAL_NAMES.has(functionName) ||
    getCliStorageCanonical(functionName) === "delete_file"
  );
}
