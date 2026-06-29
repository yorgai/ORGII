const SUBAGENT_SESSION_ID_SEGMENT = ":subagent:";

interface SessionVisibilityInput {
  session_id: string;
  orgMemberId?: string;
  parentSessionId?: string;
  parent_session_id?: string | null;
  agentOrgId?: string;
  /**
   * Imported-history rows are read-only. The helper does not consult this
   * field — a child session stays hidden regardless — but the interface
   * accepts it so upstream call sites can pass `readOnly` through without
   * stripping it first.
   */
  readOnly?: boolean;
}

export function isPrimarySessionListSession(
  session: SessionVisibilityInput
): boolean {
  const hasParentSessionId = Boolean(
    session.parentSessionId ?? session.parent_session_id
  );
  const isChildSession =
    hasParentSessionId ||
    session.session_id.includes(SUBAGENT_SESSION_ID_SEGMENT);
  if (isChildSession) return false;
  return !session.orgMemberId || Boolean(session.agentOrgId);
}
