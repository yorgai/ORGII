/**
 * Subagent Handlers — Coding Session Bridge (OS Agent only)
 *
 * The six `agent:subagent_*` WS handlers have been retired.
 * Rust now owns the entire subagent data path:
 * - `subagentSessionId` is stamped onto the parent tool_call via
 *   `update_spawning_tool_args` at spawn time.
 * - Child events flow through `push_to_store` → `es:changed`.
 * - `elapsedMs` is patched onto the parent via `stamp_elapsed_on_parent`.
 * - The parent's tool_result from `AgentTool::execute` transitions
 *   `displayStatus` to completed/failed via `merge_events`.
 *
 * Only the OS-Agent coding-session bridge remains here.
 */
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";

import { SPAWNING_TOOLS_ARRAY } from "../../shared/subagentTracking";
import type { AgentWSEvent } from "../../shared/types";
import type { EventHandlerContext } from "./types";

// ============================================================================
// Coding session bridge handlers (OS Agent only)
// ============================================================================

export function handleCodingSessionEvent(
  event: AgentWSEvent,
  _parentEventId: string,
  _ctx: EventHandlerContext
): void {
  switch (event.type) {
    case "agent:tool_call":
    case "agent:tool_result":
    case "agent:message_delta":
      break;

    case "agent:complete": {
      eventStoreProxy.updateActiveTaskArgs(
        {},
        SPAWNING_TOOLS_ARRAY,
        event.sessionId
      );
      break;
    }

    case "agent:error": {
      eventStoreProxy.updateActiveTaskArgs(
        {},
        SPAWNING_TOOLS_ARRAY,
        event.sessionId
      );
      break;
    }
  }
}
