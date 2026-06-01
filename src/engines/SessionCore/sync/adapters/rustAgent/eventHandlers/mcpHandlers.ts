/**
 * MCP Handlers.
 *
 * Bridges the Rust `agent:mcp_progress` broadcast onto the Jotai
 * `mcpProgressMapAtom` so every MCP tool chat bubble can render an
 * inline progress row while the server streams progress ticks. The
 * companion clear-on-result logic lives in `toolHandlers.ts`
 * (`handleToolResult`) to ensure the progress row disappears the moment
 * the final tool_result event lands — mirroring Claude Code's `onProgress`
 * + completion lifecycle.
 *
 * Event payload shape (matches Rust broadcast in
 * `agent_core/intelligence/mcp/bridge.rs` and the debug endpoint
 * `/agent/test/mcp/emit-progress-event`):
 *
 *   {
 *     sessionId: string,
 *     toolCallId: string,
 *     toolName:   string,
 *     progress:   number,
 *     total:      number | null,  // `null` = unbounded, number = bar cap
 *     message:    string | null,  // `null` = no label
 *   }
 *
 * Rule 13 (null vs missing): `total` and `message` are explicitly
 * preserved as `null` when the server sent an explicit null, and as
 * `undefined` when the field was absent. The atom stores `null` for both
 * cases (the UI treats them identically — no bar / no label), but we
 * guard against accidentally coercing an explicit `0` total into a
 * spinner. Empty strings are allowed through for `message` since the
 * server may intentionally clear a previous label.
 */
import {
  clearSessionMcpProgressAtom,
  updateMcpProgressAtom,
} from "@src/store/session/mcpProgressAtom";

import type { AgentWSEvent } from "../../shared/types";
import type { EventHandlerContext } from "./types";

export function handleMcpProgress(
  event: AgentWSEvent,
  sessionId: string | undefined,
  ctx: EventHandlerContext
): void {
  const resolvedSessionId =
    sessionId || event.sessionId || ctx.filterSessionIdRef.current || "";
  const toolCallId = event.toolCallId ?? "";

  if (!resolvedSessionId || !toolCallId) return;

  const toolName = event.toolName || event.tool || "";
  const progress = typeof event.progress === "number" ? event.progress : 0;

  // `total` field: `number` → bar cap, `null`/missing → spinner.
  const total = typeof event.total === "number" ? event.total : null;

  // `message` field: string → label, `null`/missing → no label.
  const message = typeof event.message === "string" ? event.message : null;

  const store = ctx.getDefaultStore();
  if (!store) return;

  store.set(updateMcpProgressAtom, {
    sessionId: resolvedSessionId,
    toolCallId,
    toolName,
    progress,
    total,
    message,
  });
}

/**
 * Session eviction: drop all MCP progress for the evicted session so
 * stale entries don't leak across session switches.
 */
export function clearSessionMcpProgress(
  sessionId: string | undefined,
  ctx: EventHandlerContext
): void {
  const resolvedSessionId = sessionId || ctx.filterSessionIdRef.current || "";
  if (!resolvedSessionId) return;
  const store = ctx.getDefaultStore();
  if (!store) return;
  store.set(clearSessionMcpProgressAtom, resolvedSessionId);
}
