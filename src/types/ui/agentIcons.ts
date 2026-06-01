/**
 * Agent Icon Mappings
 *
 * UI-specific icon mappings for agent types and tool kinds.
 * Separated from pure types to keep type files clean of UI dependencies.
 */
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Code2,
  Cpu,
  Github,
  HelpCircle,
  MousePointer2,
  Zap,
} from "lucide-react";

import type {
  StreamingAgentType,
  ToolKind,
} from "@src/api/realtime/websocket/types";

// ============================================
// Icon Mapping for Tool Kinds
// ============================================

/** Map tool kinds to suggested icons (Lucide icon names) */
export const TOOL_KIND_ICONS: Record<ToolKind, string> = {
  read: "FileText",
  write: "FilePlus",
  edit: "Pencil",
  delete: "Trash2",
  execute: "Terminal",
  search: "Search",
  web_search: "Globe",
  web_fetch: "Download",
  mcp: "Plug",
  subagent: "Bot",
  other: "Wrench",
};

// ============================================
// Icon Mapping for Agent Types
// ============================================

/** Map agent types to Lucide icon components */
export const AGENT_TYPE_ICONS: Record<StreamingAgentType, LucideIcon> = {
  claude: Bot,
  amp: Zap,
  cursor: MousePointer2,
  codex: Code2,
  acp: Cpu,
  droid: Bot,
  copilot: Github,
  unknown: HelpCircle,
};
