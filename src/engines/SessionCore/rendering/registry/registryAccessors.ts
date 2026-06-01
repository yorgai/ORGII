/**
 * Event Registry Helper Functions
 *
 * Utility functions for working with the event registry
 */
import {
  Brain,
  HelpCircle,
  type LucideIcon,
  MessageSquare,
  User,
} from "lucide-react";
import type { ComponentType, LazyExoticComponent } from "react";

import { getToolIconComponent } from "@src/config/toolIcons";
import { resolveToolName } from "@src/engines/SessionCore/rendering/registry/toolAliases";

import { getAllEventTypes, getChatContextConfig } from "./events";

export interface ComponentOption {
  id: string;
  displayName: string;
  icon: LucideIcon;
  description: string;
  component: LazyExoticComponent<ComponentType<Record<string, unknown>>>;
}
/**
 * Get action configuration for chat context.
 */
export function getActionConfig(actionType: string): {
  requiresItemIndex?: boolean;
  showStatusLine?: boolean;
} | null {
  return getChatContextConfig(actionType);
}

/**
 * Check if action_type should show status line in chat
 */
export function shouldShowStatusLine(actionType: string): boolean {
  const config = getActionConfig(actionType);
  return config?.showStatusLine ?? true;
}

/**
 * Check if component requires itemIndex prop
 */
export function requiresItemIndex(actionType: string): boolean {
  const config = getActionConfig(actionType);
  return config?.requiresItemIndex ?? false;
}

/**
 * Get all registered action types
 */
export function getRegisteredActionTypes(): string[] {
  return getAllEventTypes();
}

/**
 * Prefetch commonly used event components.
 * Uses PRELOAD_COMPONENTS from events/index.ts as single source of truth.
 */
export function prefetchCommonComponents(): void {
  import("./events").then((module) => {
    for (const eventType of module.PRELOAD_COMPONENTS) {
      module.loadEventComponent(eventType).catch(() => {
        // Silently fail - prefetch is optional
      });
    }
  });
}

// ============================================
// Trajectory timeline icons (aligned with chat)
// ============================================

/**
 * Conversation / lifecycle rows — match SessionCore chat blocks.
 * Agent replies use `MessageSquare` like `AgentMessageBlock`; tools use Rust-backed icons below.
 */
const TRAJECTORY_CHAT_ALIGNED_ICON: Record<string, LucideIcon> = {
  message: MessageSquare,
  /** User prompts — same `MessageSquare` as assistant `message` rows (chat-aligned) */
  user_message: MessageSquare,
  /** Fallback if functionName is still `user_input` before grouping */
  user_input: MessageSquare,
  thinking: Brain,
  ask_user_questions: HelpCircle,
  raw_event: User,
};

/**
 * Lucide icon for a trajectory row: same rules as chat `ToolCallBlock` / `getToolIconComponent`
 * (Rust `list_all_tools` icon ids + `TOOL_ICON_COMPONENTS` fallbacks). Pass the group's
 * representative `functionName` (first event) so grouped `command` / `search` resolve correctly.
 */
export function getTrajectoryTimelineIcon(
  groupType: string,
  toolNameForRust?: string
): LucideIcon {
  const chatAligned = TRAJECTORY_CHAT_ALIGNED_ICON[groupType];
  if (chatAligned) {
    return chatAligned;
  }

  const nameForTool =
    toolNameForRust && toolNameForRust.length > 0 ? toolNameForRust : groupType;
  return getToolIconComponent(resolveToolName(nameForTool));
}
