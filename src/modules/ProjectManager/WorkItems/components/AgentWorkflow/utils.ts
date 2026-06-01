import {
  ArrowRight,
  Check,
  Code,
  FileEdit,
  MessageSquare,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import React from "react";

import { isSubagentSpawningTool } from "@src/engines/SessionCore/sync/adapters/shared";

import type { AgentMessage } from "./types";

const TOOL_ICONS: Record<string, React.ReactNode> = {
  shell: React.createElement(Terminal, { size: 12 }),
  bash: React.createElement(Terminal, { size: 12 }),
  execute_command: React.createElement(Terminal, { size: 12 }),
  edit_file: React.createElement(FileEdit, { size: 12 }),
  file_edit: React.createElement(FileEdit, { size: 12 }),
  read_file: React.createElement(Code, { size: 12 }),
  search: React.createElement(Code, { size: 12 }),
  default: React.createElement(Wrench, { size: 12 }),
};

function getToolIcon(toolName: string | null): React.ReactNode {
  if (!toolName) return React.createElement(MessageSquare, { size: 12 });
  const key = toolName.toLowerCase();
  for (const [pattern, icon] of Object.entries(TOOL_ICONS)) {
    if (key.includes(pattern)) return icon;
  }
  return TOOL_ICONS.default;
}

export function truncate(text: string, maxLen: number): string {
  const singleLine = text.replace(/\n/g, " ").trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen) + "...";
}

export function parseSubAgentInfo(toolInput: string): {
  name: string;
  instance: number;
  description: string;
} | null {
  try {
    const parsed = JSON.parse(toolInput) as Record<string, unknown>;
    return {
      name: (parsed.agent_name as string) ?? "Sub-Agent",
      instance: (parsed.instance as number) ?? 1,
      description: (parsed.description as string) ?? "",
    };
  } catch {
    return null;
  }
}

export interface FormattedLine {
  icon: React.ReactNode;
  label: string;
  detail: string;
  isSubAgent?: boolean;
}

type TFunction = (key: string, options?: Record<string, unknown>) => string;

const MESSAGE_ROLE_I18N_KEYS: Record<string, string> = {
  assistant: "workItems.agentWorkflow.roleAssistant",
  user: "workItems.agentWorkflow.roleUser",
};

export function formatMessageLine(
  msg: AgentMessage,
  t: TFunction
): FormattedLine {
  if (msg.role === "tool_call" && msg.tool_name) {
    if (isSubagentSpawningTool(msg.tool_name) && msg.tool_input) {
      const info = parseSubAgentInfo(msg.tool_input);
      if (info) {
        return {
          icon: React.createElement(ArrowRight, { size: 12 }),
          label: `${info.name} #${info.instance}`,
          detail: info.description ? truncate(info.description, 60) : "",
          isSubAgent: true,
        };
      }
    }
    const inputPreview = msg.tool_input ? truncate(msg.tool_input, 80) : "";
    return {
      icon: getToolIcon(msg.tool_name),
      label: msg.tool_name,
      detail: inputPreview,
    };
  }
  if (msg.role === "tool_result" && msg.tool_name) {
    if (isSubagentSpawningTool(msg.tool_name)) {
      const isSuccess =
        msg.tool_output?.includes('"success"') ||
        msg.content?.includes("completed");
      return {
        icon: isSuccess
          ? React.createElement(Check, {
              size: 12,
              className: "text-success-6",
            })
          : React.createElement(XCircle, {
              size: 12,
              className: "text-danger-6",
            }),
        label: t("workItems.agentWorkflow.toolResult", {
          tool: msg.tool_name,
        }),
        detail: truncate(msg.tool_output ?? msg.content ?? "", 60),
        isSubAgent: true,
      };
    }
    const outputPreview = msg.tool_output
      ? truncate(msg.tool_output, 80)
      : msg.content
        ? truncate(msg.content, 80)
        : "";
    return {
      icon: getToolIcon(msg.tool_name),
      label: t("workItems.agentWorkflow.toolResult", {
        tool: msg.tool_name,
      }),
      detail: outputPreview,
    };
  }
  if (msg.role === "assistant" || msg.role === "user") {
    return {
      icon: React.createElement(MessageSquare, { size: 12 }),
      label: t(MESSAGE_ROLE_I18N_KEYS[msg.role]),
      detail: truncate(msg.content, 120),
    };
  }
  return {
    icon: React.createElement(Wrench, { size: 12 }),
    label: msg.role,
    detail: truncate(msg.content, 80),
  };
}
