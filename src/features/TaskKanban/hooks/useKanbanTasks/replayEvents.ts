import type { Session } from "@src/store/session";
import type { KanbanReplayEvent } from "@src/store/ui/kanbanReplayAtom";

import type { KanbanTask } from "../../types";
import { getTerminalTimestampMs } from "./replayProjection";

export interface KanbanSessionTaskPair {
  session: Session;
  task: KanbanTask;
}

export function createReplayEvents(
  pairs: readonly KanbanSessionTaskPair[]
): KanbanReplayEvent[] {
  const events: KanbanReplayEvent[] = [];
  for (const { session, task } of pairs) {
    const createdMs = session.created_at
      ? new Date(session.created_at).getTime()
      : 0;
    if (createdMs > 0) {
      events.push({
        id: `${task.id}:created`,
        ts: createdMs,
        kind: "created",
        task,
      });
    }
    const terminalMs = getTerminalTimestampMs(session);
    if (terminalMs !== null) {
      events.push({
        id: `${task.id}:terminal`,
        ts: terminalMs,
        kind: "terminal",
        task,
      });
    }
  }
  events.sort((left, right) => left.ts - right.ts);
  return events;
}
