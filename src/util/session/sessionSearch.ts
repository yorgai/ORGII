import type { Session } from "@src/store/session";

import { getSessionListDisplayName } from "./sessionSidebarRow";

export function getSessionSearchText(
  session: Session,
  fallback: string
): string {
  return [
    getSessionListDisplayName(session, fallback),
    session.user_input,
    session.repo_name,
    session.repoPath,
    session.branch,
    session.agentDisplayName,
    session.model,
    session.cliAgentType,
    ...(session.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}
