/**
 * useGroupChatFeed — helpers for the merged group chat feed.
 *
 * `buildAgentList` picks the contributing sessions; the merged event
 * array is built by `useGroupChatMergedEvents` and injected into the
 * regular `ChatHistory` pipeline via `ChatHistoryOverrideContext`.
 */
import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";

import type { GroupChatAgent } from "./types";

/**
 * Build the ordered agent list for a run: coordinator first, then
 * every member that has a live session id and visible activity. Task
 * activity and inbox activity both count; inbox-only members must stay
 * subscribed so group-chat replies do not disappear from the merged room.
 */
export function buildAgentList(
  coordinatorSessionId: string,
  members: ReadonlyArray<AgentOrgRunMemberView>
): GroupChatAgent[] {
  const agents: GroupChatAgent[] = [];
  const coordinatorMember = members.find((member) => member.isCoordinator);
  agents.push({
    id: coordinatorMember?.memberId ?? "coordinator",
    name: "Coordinator",
    sessionId: coordinatorSessionId,
    member: coordinatorMember ?? null,
    isCoordinator: true,
  });
  for (const member of members) {
    if (member.isCoordinator) continue;
    if (!member.sessionRuntime?.sessionId) continue;
    const hasVisibleActivity =
      member.inboxActivityCount > 0 ||
      member.unreadInboxCount > 0 ||
      member.activeTaskCount > 0 ||
      member.pendingTaskCount > 0 ||
      member.inProgressTaskCount > 0 ||
      member.completedTaskCount > 0;
    if (!hasVisibleActivity) continue;
    agents.push({
      id: member.memberId,
      name: member.name,
      sessionId: member.sessionRuntime.sessionId,
      member,
      isCoordinator: false,
    });
  }
  return agents;
}
