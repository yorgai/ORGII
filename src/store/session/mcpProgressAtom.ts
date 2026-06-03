/**
 * MCP Progress Atom.
 *
 * Tracks per-tool-call progress ticks streamed from MCP servers via the
 * `notifications/progress` flow. Populated by
 * `rustAgent/eventHandlers/mcpHandlers::handleMcpProgress` from the Rust
 * `agent:mcp_progress` broadcast, consumed by `FallbackAdapter` (and any
 * other chat block) to render an inline progress row inside the MCP tool
 * bubble while the tool is running.
 *
 * Key design choices:
 *
 *  - Keyed by `(sessionId, toolCallId)`: the turn executor stamps
 *    `__call_id` on every tool invocation, so the Rust `McpBridgeTool`
 *    progress callback can emit `toolCallId` verbatim. Consumers get
 *    access to a stable lookup without having to thread extra props
 *    through the render tree.
 *
 *  - `total`/`message` preserve `null` vs `undefined` (Rule 13): `null`
 *    is an explicit "no known bound / no label" from the server, while
 *    `undefined` means the field was never sent. The UI renders a
 *    spinner for `null/undefined` total and a bar for numeric total.
 *
 *  - Buckets are cleared when the tool_call completes, which happens
 *    when `clearMcpProgressForCallAtom` is written from
 *    `handleToolResult` (tool finished) or on session eviction via
 *    `clearSessionMcpProgressAtom`. This follows the progress lifecycle where
 *    the inline progress bar disappears as soon as the final tool_result lands.
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export interface McpProgressState {
  toolCallId: string;
  toolName: string;
  progress: number;
  total: number | null;
  message: string | null;
  updatedAt: number;
}

/** Map<sessionId, Map<toolCallId, McpProgressState>> */
export type McpProgressMap = Map<string, Map<string, McpProgressState>>;

// ============================================
// Atoms
// ============================================

export const mcpProgressMapAtom = atom<McpProgressMap>(new Map());
mcpProgressMapAtom.debugLabel = "mcpProgressMap";

/**
 * Write atom: upsert a progress tick from the Rust broadcast.
 */
export const updateMcpProgressAtom = atom(
  null,
  (
    get,
    set,
    action: {
      sessionId: string;
      toolCallId: string;
      toolName: string;
      progress: number;
      total: number | null;
      message: string | null;
    }
  ) => {
    const { sessionId, toolCallId } = action;
    if (!sessionId || !toolCallId) return;

    const currentMap = get(mcpProgressMapAtom);
    const newMap = new Map(currentMap);
    const existingSession = newMap.get(sessionId);
    const newSession = existingSession
      ? new Map(existingSession)
      : new Map<string, McpProgressState>();
    newSession.set(toolCallId, {
      toolCallId,
      toolName: action.toolName,
      progress: action.progress,
      total: action.total,
      message: action.message,
      updatedAt: Date.now(),
    });
    newMap.set(sessionId, newSession);
    set(mcpProgressMapAtom, newMap);
  }
);
updateMcpProgressAtom.debugLabel = "updateMcpProgress";

/**
 * Write atom: drop the progress entry for a single tool_call.
 * Called from `handleToolResult` so the bubble stops rendering the
 * inline progress row once the final result lands.
 */
export const clearMcpProgressForCallAtom = atom(
  null,
  (
    get,
    set,
    action: {
      sessionId: string;
      toolCallId: string;
    }
  ) => {
    const { sessionId, toolCallId } = action;
    if (!sessionId || !toolCallId) return;
    const currentMap = get(mcpProgressMapAtom);
    const sessionMap = currentMap.get(sessionId);
    if (!sessionMap || !sessionMap.has(toolCallId)) return;
    const newSession = new Map(sessionMap);
    newSession.delete(toolCallId);
    const newMap = new Map(currentMap);
    if (newSession.size === 0) {
      newMap.delete(sessionId);
    } else {
      newMap.set(sessionId, newSession);
    }
    set(mcpProgressMapAtom, newMap);
  }
);
clearMcpProgressForCallAtom.debugLabel = "clearMcpProgressForCall";

/**
 * Write atom: drop all progress entries for a session (eviction / cleanup).
 */
export const clearSessionMcpProgressAtom = atom(
  null,
  (get, set, sessionId: string) => {
    if (!sessionId) return;
    const currentMap = get(mcpProgressMapAtom);
    if (!currentMap.has(sessionId)) return;
    const newMap = new Map(currentMap);
    newMap.delete(sessionId);
    set(mcpProgressMapAtom, newMap);
  }
);
clearSessionMcpProgressAtom.debugLabel = "clearSessionMcpProgress";

/**
 * Read helper: look up a single progress entry by `(sessionId, toolCallId)`.
 */
export function getMcpProgress(
  progressMap: McpProgressMap,
  sessionId: string,
  toolCallId: string
): McpProgressState | undefined {
  return progressMap.get(sessionId)?.get(toolCallId);
}
