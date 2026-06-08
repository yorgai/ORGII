/**
 * Event Visibility Filters
 *
 * Determines which events should be shown in different UI contexts:
 * - Chat panel
 * - Simulator (replay)
 * - Messages app
 *
 * These filters are also implemented in Rust (event_store/derived.rs)
 * for the Tauri-side derived computations. The TS versions are used
 * by Jotai derived atoms that need synchronous filtering.
 */
import { isRunningSessionEvent } from "../core/runningEventGate";
import type { SessionEvent } from "../core/types";
import { PLAN_EVENT_NAME } from "../derived/planDisplayEvents";

// ============================================
// Utility Functions
// ============================================

/**
 * Strip triple-backtick code blocks that wrap terminal output.
 *
 * When the agent calls a terminal tool, the output often arrives wrapped in
 * triple-backtick blocks like:
 *   ```shell
 *   actual output
 *   ```
 *
 * For display in the chat history we strip those wrappers so the output
 * renders as plain text instead of a code block inside a code block.
 */
export function stripTerminalCodeBlocks(text: string): string {
  // Only strip leading ```xyz and trailing ```
  // Don't strip all code blocks — only the outermost terminal wrapper
  let result = text;

  // Strip leading ```xyz\n  (common: shell, bash, sh, zsh, terminal)
  const leadingMatch = result.match(
    /^```(?:shell|bash|sh|zsh|terminal|console|output|)[ \t]*\n/i
  );
  if (leadingMatch) {
    result = result.slice(leadingMatch[0].length);
  }

  // Strip trailing \n``` at end of string
  if (/\n```\s*$/.test(result)) {
    result = result.replace(/\n```\s*$/, "");
  }

  return result;
}

// ============================================
// Visibility Filters
// ============================================

/**
 * Check if an event should be shown in chat panel.
 * Filters out empty thinking events and other non-chat events.
 */
export function isVisibleInChat(event: SessionEvent): boolean {
  // NOTE: thinking deltas (isDelta=true, variant="thinking") are now allowed
  // through so the chat panel can show a live streaming cursor while the
  // model reasons. Empty thinking deltas are still caught by the
  // has_thinking_content guard below.

  // Hide session start/end from chat
  if (event.displayVariant === "session") {
    return false;
  }

  // Hide task lifecycle and stage errors from chat (no UI components).
  // Mirrors Rust is_visible_in_chat() in derived.rs.
  if (
    event.actionType === "task_start" ||
    event.actionType === "task_completed" ||
    event.actionType === "task_failed" ||
    event.actionType === "stage_error"
  ) {
    return false;
  }

  // Hide standalone tool_result events — they should be merged into their
  // parent tool_call. If one slips through (e.g. missing callId), hide it
  // to avoid duplicate display.
  if (event.actionType === "tool_result") {
    return false;
  }

  // Hide empty thinking events (end markers with no content)
  if (event.displayVariant === "thinking") {
    const result = event.result || {};
    const hasContent = Boolean(
      (result.thought as string)?.trim() ||
      (result.content as string)?.trim() ||
      (result.observation as string)?.trim()
    );
    if (!hasContent) {
      return false;
    }
  }

  // Hide whitespace-only assistant/message events (e.g. "\n\n" content)
  if (event.displayVariant === "message" && event.actionType === "assistant") {
    const result = event.result || {};
    const content =
      (result.content as string) ||
      (result.observation as string) ||
      event.displayText ||
      "";
    if (!content.trim()) {
      return false;
    }
  }

  return true;
}

/**
 * Tool names that spawn subagents.
 * Running-state events for these tools are shown in Trajectory/Simulator so
 * subagent progress (injected via updateActiveTaskArgs) is visible immediately.
 * Must mirror SPAWNING_TOOL_NAMES in Rust derived.rs.
 */
const SPAWNING_TOOL_NAMES = new Set([
  "agent",
  "task",
  "Task",
  "spawn_sub_agent",
  "subagent",
]);

/**
 * Shell tool names whose running-state events should stay visible in the
 * Simulator so the COMMANDS panel shows live streamOutput while a command
 * executes.  Must mirror SHELL_TOOL_NAMES in Rust derived.rs.
 */
const SHELL_TOOL_NAMES = new Set([
  "bash",
  "shell",
  "execute_command",
  "run_terminal_command",
  "terminal",
  "terminal_command",
  "run_shell",
]);

const PLAN_EVENT_NAMES: ReadonlySet<string> = new Set([
  PLAN_EVENT_NAME.CREATE_PLAN,
  PLAN_EVENT_NAME.PLAN_APPROVAL,
]);

/**
 * Shared implementation for simulator and Messages app visibility.
 * Both contexts show completed tool calls, thinking events, and messages
 * but hide streaming deltas and in-progress status events.
 *
 * Spawning tool calls (agent, task, …) and shell tool calls are shown even
 * while Running so that subagent progress and live command output are visible.
 */
function isVisibleInSimulatorOrMessages(event: SessionEvent): boolean {
  // Hide streaming deltas (show only final events)
  if (event.isDelta) {
    return false;
  }

  // Hide "running" status events — except for tool calls whose live args are
  // user-visible in replay.
  if (
    isRunningSessionEvent(event) &&
    !(
      event.displayVariant === "tool_call" &&
      (SPAWNING_TOOL_NAMES.has(event.functionName) ||
        SHELL_TOOL_NAMES.has(event.functionName) ||
        PLAN_EVENT_NAMES.has(event.functionName))
    )
  ) {
    return false;
  }

  // Show tool calls, thinking, and messages (including user turns)
  return (
    event.displayVariant === "tool_call" ||
    event.displayVariant === "thinking" ||
    event.displayVariant === "message"
  );
}

/**
 * Check if an event should be shown in simulator.
 * Includes tool_call, thinking, and message events (assistant and user).
 * Excludes streaming deltas and "running" status events (show only completed).
 */
export function isVisibleInSimulator(event: SessionEvent): boolean {
  return isVisibleInSimulatorOrMessages(event);
}

/**
 * Check if an event should be shown in the Messages app.
 * Uses the same visibility rules as {@link isVisibleInSimulator}.
 */
export function isVisibleInMessages(event: SessionEvent): boolean {
  return isVisibleInSimulatorOrMessages(event);
}
