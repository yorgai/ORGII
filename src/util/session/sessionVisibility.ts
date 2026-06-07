import { GUI_CONTROL_SESSION_PREFIX } from "@src/util/session/sessionDispatch";

const SUBAGENT_SESSION_ID_SEGMENT = ":subagent:";

interface SessionVisibilityInput {
  session_id: string;
  orgMemberId?: string;
  parentSessionId?: string;
  agentOrgId?: string;
}

export function isPrimarySessionListSession(
  session: SessionVisibilityInput
): boolean {
  if (session.session_id.startsWith(GUI_CONTROL_SESSION_PREFIX)) return true;

  const isChildSession =
    Boolean(session.parentSessionId) ||
    session.session_id.includes(SUBAGENT_SESSION_ID_SEGMENT);
  if (isChildSession) return false;
  return !session.orgMemberId || Boolean(session.agentOrgId);
}
