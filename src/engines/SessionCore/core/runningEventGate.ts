import { isInteractiveTool } from "./interactiveTools";
import type { SessionEvent } from "./types";

const TERMINAL_SHELL_PROCESS_STATUSES = new Set(["exited", "killed"]);
const ACTIVE_SHELL_PROCESS_STATUSES = new Set(["running", "background"]);
const TURN_BLOCKING_SHELL_PROCESS_STATUSES = new Set(["running"]);

/**
 * Running-state gates intentionally model different product questions.
 *
 * - Live runtime resource: anything still alive or diagnostically relevant.
 *   Includes background shells and hidden status sentinels. Use for replay,
 *   planning footer, visibility filtering, dedup, and diagnostic surfaces.
 * - Composer stop-blocking work: foreground user-stoppable work only. This
 *   may hold the main composer in Stop state (Stop vs. Send icon).
 * - Timeline boundary closable event: running work that can be force-closed
 *   during stop/force-send/rewind boundary transitions.
 *
 * NONE of these gates participate in queue dispatch or submit routing — turn
 * finality is owned exclusively by the turn-lifecycle FSM
 * (`control/turnLifecycle.ts`).
 */

export function shellProcessStatusFromArgs(args: unknown): string | undefined {
  if (!args) return undefined;
  if (typeof args === "object") {
    return (args as { shellProcessStatus?: string }).shellProcessStatus;
  }
  if (typeof args !== "string") return undefined;
  try {
    const parsed = JSON.parse(args) as { shellProcessStatus?: string };
    return parsed.shellProcessStatus;
  } catch {
    return undefined;
  }
}

export function isLiveRuntimeResourceEvent(event: SessionEvent): boolean {
  const shellProcessStatus = shellProcessStatusFromArgs(event.args);
  if (
    shellProcessStatus &&
    TERMINAL_SHELL_PROCESS_STATUSES.has(shellProcessStatus)
  ) {
    return false;
  }
  return (
    event.displayStatus === "running" ||
    event.result?.status === "running" ||
    Boolean(
      shellProcessStatus &&
      ACTIVE_SHELL_PROCESS_STATUSES.has(shellProcessStatus)
    )
  );
}

export function isTurnBlockingRuntimeEvent(event: SessionEvent): boolean {
  const shellProcessStatus = shellProcessStatusFromArgs(event.args);
  if (shellProcessStatus) {
    return TURN_BLOCKING_SHELL_PROCESS_STATUSES.has(shellProcessStatus);
  }
  return (
    event.displayStatus === "running" || event.result?.status === "running"
  );
}

export function isComposerStopBlockingEvent(event: SessionEvent): boolean {
  if (!isTurnBlockingRuntimeEvent(event)) return false;

  const shellProcessStatus = shellProcessStatusFromArgs(event.args);
  if (shellProcessStatus) {
    return TURN_BLOCKING_SHELL_PROCESS_STATUSES.has(shellProcessStatus);
  }

  return (
    event.actionType === "tool_call" || event.displayVariant === "tool_call"
  );
}

export function sessionHasComposerStopBlockingWork(
  events: readonly SessionEvent[],
  sessionId: string
): boolean {
  return events.some((event) => {
    if (event.sessionId && event.sessionId !== sessionId) return false;
    return isComposerStopBlockingEvent(event);
  });
}

export function isTimelineBoundaryClosableRuntimeEvent(
  event: SessionEvent,
  sessionId: string
): boolean {
  if (event.sessionId && event.sessionId !== sessionId) return false;
  if (!isLiveRuntimeResourceEvent(event)) return false;
  if (
    isInteractiveTool(event.functionName) ||
    isInteractiveTool(event.uiCanonical)
  ) {
    return false;
  }
  return true;
}
