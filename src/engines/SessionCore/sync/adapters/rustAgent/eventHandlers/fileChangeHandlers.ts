/**
 * File / Repo / Heartbeat Handlers
 *
 * Handlers for Rust wire events that were previously dropped by the
 * `dispatchAgentEvent` `default: break` branch:
 *
 *   - `agent:file_change`       — the agent wrote/created/deleted files;
 *                                 broadcast so the file tree, git status,
 *                                 and any open editors can refresh.
 *   - `agent:setup_repo_update` — the `setup_repo` tool reported progress
 *                                 (clone / branch / install steps); surfaced
 *                                 so a setup-progress surface can render it.
 *   - `agent:heartbeat`         — periodic liveness ping from a long-running
 *                                 automation turn; used to keep the session
 *                                 marked alive when no other events flow.
 *
 * All three are forwarded as `window` CustomEvents rather than written to
 * the EventStore: they are side-channel signals, not chat transcript rows.
 * Feature modules opt in by listening for the corresponding event name.
 */
import { createLogger } from "@src/hooks/logger";

import type { AgentWSEvent } from "../../shared/types";

const logger = createLogger("FileChangeHandlers");

/**
 * Window event name constants. Centralized so listeners and emitters
 * cannot drift apart via stringly-typed names.
 */
export const AGENT_SIDE_CHANNEL_EVENTS = {
  /** Detail: `{ sessionId, tool, files, workspacePath }`. */
  FILE_CHANGE: "agent-file-change",
  /** Detail: `{ sessionId, action, data }`. */
  SETUP_REPO_UPDATE: "agent-setup-repo-update",
  /** Detail: `{ sessionId, at }`. */
  HEARTBEAT: "agent-heartbeat",
} as const;

export interface AgentFileChangeDetail {
  sessionId: string;
  tool: string;
  files: string[];
  workspacePath: string;
}

export interface AgentSetupRepoUpdateDetail {
  sessionId: string;
  action: string;
  data: Record<string, unknown>;
}

export interface AgentHeartbeatDetail {
  sessionId: string;
  /** ISO timestamp the heartbeat was observed by the frontend. */
  at: string;
}

/**
 * `agent:file_change` — the agent's edit/create/delete tool touched files
 * on disk. The Rust event carries the absolute file paths plus the
 * workspace root. We re-broadcast it so:
 *   - the WorkStation file tree can mark the rows dirty
 *   - the git status poller can schedule an immediate refresh
 *   - any open editor for an affected file can offer a reload
 */
export function handleFileChange(
  event: AgentWSEvent,
  eventSessionId: string | undefined
): void {
  if (!eventSessionId) return;
  const files = Array.isArray(event.files) ? event.files : [];
  if (files.length === 0) return;

  const detail: AgentFileChangeDetail = {
    sessionId: eventSessionId,
    tool: event.tool ?? event.toolName ?? "unknown",
    files,
    workspacePath: event.workspacePath ?? "",
  };

  logger.debug(
    `file_change: ${files.length} file(s) via ${detail.tool} in ${eventSessionId}`
  );
  window.dispatchEvent(
    new CustomEvent(AGENT_SIDE_CHANNEL_EVENTS.FILE_CHANGE, { detail })
  );
}

/**
 * `agent:setup_repo_update` — progress from the non-blocking `setup_repo`
 * tool (clone / checkout / dependency install). Forwarded for a
 * setup-progress UI; carries the raw tool params under `data`.
 */
export function handleSetupRepoUpdate(
  event: AgentWSEvent,
  eventSessionId: string | undefined
): void {
  if (!eventSessionId || !event.action) return;

  // The Rust `agent:setup_repo_update` payload nests the raw tool params
  // under `data` (see setup_repo.rs `execute_text`). `data` is not on the
  // typed `AgentWSEvent` superset, so read it via an index access.
  const rawData = (event as unknown as Record<string, unknown>).data;
  const data =
    rawData && typeof rawData === "object"
      ? (rawData as Record<string, unknown>)
      : {};

  const detail: AgentSetupRepoUpdateDetail = {
    sessionId: eventSessionId,
    action: event.action,
    data,
  };

  logger.debug(
    `setup_repo_update: action=${detail.action} session=${eventSessionId}`
  );
  window.dispatchEvent(
    new CustomEvent(AGENT_SIDE_CHANNEL_EVENTS.SETUP_REPO_UPDATE, { detail })
  );
}

/**
 * `agent:heartbeat` — periodic liveness ping emitted by long-running
 * automation turns that may otherwise go quiet between LLM calls. The
 * heartbeat is forwarded so a watchdog can distinguish "still working"
 * from "silently died" without flipping the chat transcript.
 */
export function handleHeartbeat(
  event: AgentWSEvent,
  eventSessionId: string | undefined
): void {
  if (!eventSessionId) return;

  const detail: AgentHeartbeatDetail = {
    sessionId: eventSessionId,
    at: new Date().toISOString(),
  };
  window.dispatchEvent(
    new CustomEvent(AGENT_SIDE_CHANNEL_EVENTS.HEARTBEAT, { detail })
  );
}
