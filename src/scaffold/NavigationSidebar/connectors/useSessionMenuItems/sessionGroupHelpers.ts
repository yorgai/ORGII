import type { SessionGroupKey } from "@src/config/sessionAgentGroups";
import type { SessionListCategory } from "@src/store/session";

export function groupKeyToWireCategory(
  groupKey: SessionGroupKey
): SessionListCategory {
  if (groupKey === "cursor_ide") return "cursor_ide";
  if (groupKey === "cli") return "cli_agent";
  return "rust_agent";
}
