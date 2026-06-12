import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { TOOL_DISPLAY_BEHAVIOR } from "@src/engines/SessionCore/rendering/registry/types";
import type { ToolDisplayBehavior } from "@src/engines/SessionCore/rendering/registry/types";
import { getEventStatus } from "@src/util/data/converters/eventStatus";

export const FINAL_RESULT_HOLD_MS = 1000;

const FINAL_HOLD_BEHAVIORS = new Set<ToolDisplayBehavior>([
  TOOL_DISPLAY_BEHAVIOR.STREAM,
  TOOL_DISPLAY_BEHAVIOR.WAIT_FOR_RESULT,
]);

export function shouldHoldFinalToolResult(
  event: SessionEvent | null | undefined,
  behavior: ToolDisplayBehavior
): boolean {
  if (!event || event.displayVariant !== "tool_call") return false;
  if (!FINAL_HOLD_BEHAVIORS.has(behavior)) return false;

  const status = getEventStatus(event) || event.displayStatus;
  return status !== "running" && status !== "pending";
}

export function getFinalResultHoldRemainingMs(
  nowMs: number,
  finalSeenAtMs: number | undefined
): number {
  if (finalSeenAtMs === undefined) return FINAL_RESULT_HOLD_MS;
  return Math.max(0, FINAL_RESULT_HOLD_MS - (nowMs - finalSeenAtMs));
}
