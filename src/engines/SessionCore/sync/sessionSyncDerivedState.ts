import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

export function isDuplicateSessionSyncInvocation(
  sessionId: string,
  reloadEpoch: number,
  previousSessionId: string | null,
  previousReloadEpoch: number
): boolean {
  return previousSessionId === sessionId && previousReloadEpoch === reloadEpoch;
}

export function isCursorIdeSessionId(sessionId: string): boolean {
  return isCursorIdeSession(sessionId);
}
