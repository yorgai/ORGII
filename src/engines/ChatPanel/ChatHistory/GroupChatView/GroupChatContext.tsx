import React, { createContext, useContext, useMemo } from "react";

import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  isCoordinatorHumanUserEvent,
  resolveGroupMessageRecipient,
  resolveGroupSenderName,
} from "./groupChatUtils";

export interface GroupChatContextValue {
  enabled: boolean;
  coordinatorSessionId: string;
  orgMembers: ReadonlyArray<AgentOrgRunMemberView>;
  resolveSenderName: (event: SessionEvent) => string;
  resolveRecipientName: (event: SessionEvent) => string | null;
  isCoordinatorTurnHeader: (event: SessionEvent) => boolean;
}

const GroupChatContext = createContext<GroupChatContextValue | null>(null);

GroupChatContext.displayName = "GroupChatContext";

export function GroupChatProvider({
  enabled,
  coordinatorSessionId,
  orgMembers,
  children,
}: {
  enabled: boolean;
  coordinatorSessionId: string;
  orgMembers: ReadonlyArray<AgentOrgRunMemberView>;
  children: React.ReactNode;
}) {
  const value = useMemo<GroupChatContextValue>(
    () => ({
      enabled,
      coordinatorSessionId,
      orgMembers,
      resolveSenderName: (event: SessionEvent) =>
        resolveGroupSenderName(event, coordinatorSessionId, orgMembers),
      resolveRecipientName: (event: SessionEvent) =>
        resolveGroupMessageRecipient(event, coordinatorSessionId, orgMembers),
      isCoordinatorTurnHeader: (event: SessionEvent) =>
        isCoordinatorHumanUserEvent(event, coordinatorSessionId),
    }),
    [enabled, coordinatorSessionId, orgMembers]
  );

  return (
    <GroupChatContext.Provider value={enabled ? value : null}>
      {children}
    </GroupChatContext.Provider>
  );
}

export function useGroupChatContext(): GroupChatContextValue | null {
  return useContext(GroupChatContext);
}
