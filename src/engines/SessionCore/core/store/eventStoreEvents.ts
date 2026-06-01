import { isBackendUserMessageEvent } from "@src/engines/SessionCore/sync/utils/activityIds";

import type { SessionEvent } from "../types";

export function inferSessionId(events: SessionEvent[]): string | null {
  if (events.length === 0) return null;
  const firstSessionId = events[0]?.sessionId;
  if (!firstSessionId) return null;
  return events.every((event) => event.sessionId === firstSessionId)
    ? firstSessionId
    : null;
}

export function isRealUserEvent(event: SessionEvent): boolean {
  return isBackendUserMessageEvent(event);
}
