import i18next from "i18next";

import { getToolLabel } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import type { LifecycleState } from "@src/engines/SessionCore/rendering/registry/useToolLabel";
import type { EventStatus } from "@src/engines/SessionCore/rendering/types/universalProps";

import { formatToolName } from "./formatToolName";

export function getRegistryToolLabelText(
  toolName: string,
  state: LifecycleState,
  action?: string
): string {
  const key = getToolLabel(toolName, state, action);
  return key ? i18next.t(key, { ns: "sessions" }) : "";
}

function toLifecycleState(status: EventStatus | string): LifecycleState {
  if (status === "running" || status === "pending") return "running";
  if (status === "success" || status === "done" || status === "completed") {
    return "done";
  }
  return "failed";
}

export function getToolDisplayLabelFromRegistry(
  toolName: string,
  action?: string
): string {
  const label = getRegistryToolLabelText(toolName, "done", action);
  return label || formatToolName(toolName);
}

export function getToolTitleFromRegistry(
  toolName: string,
  status: EventStatus | string,
  action?: string
): string {
  const state = toLifecycleState(status);
  const label = getRegistryToolLabelText(toolName, state, action);
  return label || formatToolName(toolName);
}
