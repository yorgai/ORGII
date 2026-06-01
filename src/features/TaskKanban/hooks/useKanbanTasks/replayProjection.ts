import type { Session } from "@src/store/session";

import type { KanbanTask } from "../../types";

export function isTerminalStatus(status: Session["status"]): boolean {
  switch (status) {
    case "completed":
    case "failed":
    case "error":
    case "timeout":
    case "killed":
    case "cancelled":
    case "abandoned":
      return true;
    default:
      return false;
  }
}

export function getTerminalTimestampMs(session: Session): number | null {
  if (!isTerminalStatus(session.status)) return null;
  const explicit = session.completed_at
    ? new Date(session.completed_at).getTime()
    : 0;
  if (explicit > 0) return explicit;
  const fallback = session.updated_at
    ? new Date(session.updated_at).getTime()
    : 0;
  return fallback > 0 ? fallback : null;
}

export function applyReplayCursor(
  task: KanbanTask,
  session: Session,
  cursorMs: number
): KanbanTask | null {
  const createdMs = session.created_at
    ? new Date(session.created_at).getTime()
    : 0;
  if (cursorMs < createdMs) return null;

  const terminalMs = getTerminalTimestampMs(session);
  if (terminalMs === null) return task;

  if (cursorMs >= terminalMs) return task;
  return {
    ...task,
    status: "in_progress" as KanbanTask["status"],
    resultStatus: undefined,
    isUnread: false,
  };
}
