/**
 * Tool row icons for the built-in tools Integrations UI.
 * Uses `getToolIcon` with the raw tool name — same as ToolCallBlock.
 * Do not use `resolveToolName` for icons: many tools (e.g. manage_lsp) alias to `tool_call`
 * for the event registry only; that key is not in TOOL_ICONS and would fall back to Wrench.
 */
import type { ReactNode } from "react";

import { getToolIcon } from "@src/engines/ChatPanel/blocks/ToolCallBlock/config";

export function getBuiltInToolChatIcon(
  toolName: string,
  iconId?: string | null
): ReactNode {
  return getToolIcon(toolName, { iconId });
}
