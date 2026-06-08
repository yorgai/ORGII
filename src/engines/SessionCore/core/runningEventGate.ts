import { isInteractiveTool } from "./interactiveTools";
import type { SessionEvent } from "./types";

const TERMINAL_SHELL_PROCESS_STATUSES = new Set(["exited", "killed"]);
const ACTIVE_SHELL_PROCESS_STATUSES = new Set(["running", "background"]);
const TURN_BLOCKING_SHELL_PROCESS_STATUSES = new Set(["running"]);

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

export function isRunningSessionEvent(event: SessionEvent): boolean {
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

export function hasRunningSessionEvent(
  events: readonly SessionEvent[],
  sessionId: string
): boolean {
  return events.some((event) => {
    if (event.sessionId && event.sessionId !== sessionId) return false;
    return isRunningSessionEvent(event);
  });
}

export function isTurnBlockingRunningSessionEvent(
  event: SessionEvent
): boolean {
  const shellProcessStatus = shellProcessStatusFromArgs(event.args);
  if (shellProcessStatus) {
    return TURN_BLOCKING_SHELL_PROCESS_STATUSES.has(shellProcessStatus);
  }
  return (
    event.displayStatus === "running" || event.result?.status === "running"
  );
}

export function hasTurnBlockingRunningSessionEvent(
  events: readonly SessionEvent[],
  sessionId: string
): boolean {
  return events.some((event) => {
    if (event.sessionId && event.sessionId !== sessionId) return false;
    return isTurnBlockingRunningSessionEvent(event);
  });
}

export function isTimelineBoundaryClosableRunningEvent(
  event: SessionEvent,
  sessionId: string
): boolean {
  if (event.sessionId && event.sessionId !== sessionId) return false;
  if (!isRunningSessionEvent(event)) return false;
  if (
    isInteractiveTool(event.functionName) ||
    isInteractiveTool(event.uiCanonical)
  ) {
    return false;
  }
  return true;
}
