import { memo, useEffect, useMemo } from "react";

import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";
import { parseRawSessionEvent } from "@src/engines/SessionCore/core/schemas";
import "@src/engines/SessionCore/sync/adapters";
import { getAdapterForSession } from "@src/engines/SessionCore/sync/types";
import { useSessionChannel } from "@src/engines/SessionCore/sync/useSessionChannel";

const PENDING_MEMBER_SESSION_PREFIX = "agent-org-member-pending:";

interface AgentOrgGroupChatLiveSessionsProps {
  enabled: boolean;
  excludeSessionId?: string | null;
  members: ReadonlyArray<AgentOrgRunMemberView>;
}

interface LiveSessionTapProps {
  sessionId: string;
}

function LiveSessionTap({ sessionId }: LiveSessionTapProps) {
  const handler = useMemo(() => {
    const adapter = getAdapterForSession(sessionId);
    if (!adapter) return null;
    return adapter.createEventHandler(sessionId, {});
  }, [sessionId]);

  useEffect(() => {
    return () => handler?.dispose();
  }, [handler]);

  useSessionChannel(handler ? sessionId : null, (raw) => {
    if (!handler) return;
    handler.handleEvent(parseRawSessionEvent(raw));
  });

  return null;
}

export const AgentOrgGroupChatLiveSessions = memo(
  ({
    enabled,
    excludeSessionId,
    members,
  }: AgentOrgGroupChatLiveSessionsProps) => {
    const sessionIds = useMemo(() => {
      if (!enabled) return [];
      const ids = new Set<string>();
      for (const member of members) {
        const sessionId = member.sessionRuntime?.sessionId;
        if (
          !sessionId ||
          sessionId === excludeSessionId ||
          sessionId.startsWith(PENDING_MEMBER_SESSION_PREFIX)
        ) {
          continue;
        }
        ids.add(sessionId);
      }
      return [...ids];
    }, [enabled, excludeSessionId, members]);

    if (!enabled) return null;

    return (
      <>
        {sessionIds.map((sessionId) => (
          <LiveSessionTap key={sessionId} sessionId={sessionId} />
        ))}
      </>
    );
  }
);

AgentOrgGroupChatLiveSessions.displayName = "AgentOrgGroupChatLiveSessions";
