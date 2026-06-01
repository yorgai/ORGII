const SUBAGENT_SESSION_ID_SEGMENT = ":subagent:";

interface SessionVisibilityInput {
  session_id: string;
  orgMemberId?: string;
  parentSessionId?: string;
}

export function isPrimarySessionListSession(
  session: SessionVisibilityInput
): boolean {
  return (
    !session.orgMemberId &&
    !session.parentSessionId &&
    !session.session_id.includes(SUBAGENT_SESSION_ID_SEGMENT)
  );
}
