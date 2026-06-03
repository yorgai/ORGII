/**
 * Session Agent Groups
 *
 * Per-agent-type groupings for session sidebar display.
 * Splits Rust agents into OS / SDE / Wingman sections instead of
 * lumping them all under a single "Coding Agent" heading.
 */
import {
  RUST_AGENT_TYPE,
  type RustAgentType,
} from "@src/api/tauri/agent/types";
import {
  getRustAgentType,
  isCliSession,
  isCursorIdeSession,
} from "@src/util/session/sessionDispatch";

export type SessionGroupKey = RustAgentType | "cli" | "cursor_ide";

/** Derive a fine-grained group key from a session ID. */
export function getSessionGroupKey(sessionId: string): SessionGroupKey {
  if (isCursorIdeSession(sessionId)) return "cursor_ide";
  if (isCliSession(sessionId)) return "cli";
  return getRustAgentType(sessionId);
}

/** Display order for session sidebar groups. */
export const SESSION_GROUP_ORDER: readonly SessionGroupKey[] = [
  RUST_AGENT_TYPE.OS,
  RUST_AGENT_TYPE.SDE,
  RUST_AGENT_TYPE.TERMINAL,
  RUST_AGENT_TYPE.WINGMAN,
  "cli",
  "cursor_ide",
];

/** Labels for each group — not localised (agent names stay English). */
export const SESSION_GROUP_LABELS: Record<SessionGroupKey, string> = {
  [RUST_AGENT_TYPE.OS]: "OS Agent",
  [RUST_AGENT_TYPE.SDE]: "SDE Agent",
  [RUST_AGENT_TYPE.TERMINAL]: "Terminal Agent",
  [RUST_AGENT_TYPE.WINGMAN]: "Wingman Agent",
  [RUST_AGENT_TYPE.CUSTOM]: "Custom Agent",
  cli: "CLI Agent",
  cursor_ide: "Cursor History",
};
