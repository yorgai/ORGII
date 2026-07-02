/**
 * Leave-org local cleanup (design §8.4) as a PURE function over a snapshot
 * of the collab store state, so the whole matrix is unit-testable without
 * React or jotai. The caller (useMemberActions.handleLeaveOrg) reads the
 * atoms, applies this, and writes the results back; removing the org from
 * `collabOrgsAtom` is also what makes `CollabSyncEngine.reconcile()` drop
 * the org's pull loop and, with no orgs left, tear down every push
 * subscription (zero-subscription idle).
 */
import type { CollabSessionPushCursor } from "@src/store/collaboration/collabOrgsAtom";
import type {
  CollabChatMessageRecord,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgConnectionState,
  CollabOrgRecord,
  CollabRepoJoinRequestRecord,
  CollabSessionAccessSettings,
  CollabSessionSnapshotRequestRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

export interface CollabOrgLocalState {
  orgs: CollabOrgRecord[];
  members: CollabMemberRecord[];
  invites: CollabInviteRecord[];
  accessSettings: CollabSessionAccessSettings[];
  repoJoinRequests: CollabRepoJoinRequestRecord[];
  chatMessages: CollabChatMessageRecord[];
  snapshotRequests: CollabSessionSnapshotRequestRecord[];
  remoteSessions: RemoteTeammateSessionMetadata[];
  connectionStates: CollabOrgConnectionState[];
  /** Keyed by `${orgId}:${sessionId}`. */
  pushCursors: Record<string, CollabSessionPushCursor>;
  /** Keyed by orgId. */
  lastSyncTimestamps: Record<string, string>;
  sessions: Session[];
}

export interface LeaveOrgCleanupResult extends CollabOrgLocalState {
  /**
   * Local session ids removed because they were imported from the org the
   * member just left. Empty unless `removeImportedSessions` was requested;
   * when empty, `sessions` is the input array (identity) so callers can
   * skip the sessionsAtom write + persistSessions.
   */
  removedSessionIds: string[];
}

export function computeLeaveOrgCleanup(
  state: CollabOrgLocalState,
  orgId: string,
  options: { removeImportedSessions: boolean }
): LeaveOrgCleanupResult {
  const removedSessionIds = options.removeImportedSessions
    ? state.sessions
        .filter((session) => session.importedFrom?.orgId === orgId)
        .map((session) => session.session_id)
    : [];
  const removedSessionIdSet = new Set(removedSessionIds);

  const { [orgId]: _removedTimestamp, ...lastSyncTimestamps } =
    state.lastSyncTimestamps;

  return {
    orgs: state.orgs.filter((org) => org.id !== orgId),
    members: state.members.filter((member) => member.orgId !== orgId),
    invites: state.invites.filter((invite) => invite.orgId !== orgId),
    accessSettings: state.accessSettings.filter(
      (settings) => settings.orgId !== orgId
    ),
    repoJoinRequests: state.repoJoinRequests.filter(
      (request) => request.orgId !== orgId
    ),
    chatMessages: state.chatMessages.filter(
      (message) => message.orgId !== orgId
    ),
    snapshotRequests: state.snapshotRequests.filter(
      (request) => request.orgId !== orgId
    ),
    remoteSessions: state.remoteSessions.filter(
      (session) => session.orgId !== orgId
    ),
    connectionStates: state.connectionStates.filter(
      (connectionState) => connectionState.orgId !== orgId
    ),
    pushCursors: Object.fromEntries(
      Object.entries(state.pushCursors).filter(
        ([, cursor]) => cursor.orgId !== orgId
      )
    ),
    lastSyncTimestamps,
    sessions:
      removedSessionIds.length > 0
        ? state.sessions.filter(
            (session) => !removedSessionIdSet.has(session.session_id)
          )
        : state.sessions,
    removedSessionIds,
  };
}
