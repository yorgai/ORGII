import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef } from "react";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import {
  collabChatMessagesAtom,
  collabConnectionStatesAtom,
  collabInvitesAtom,
  collabLastSyncTimestampsAtom,
  collabMembersAtom,
  collabOrgsAtom,
  collabProjectsAtom,
  collabRepoJoinRequestsAtom,
  collabSessionAccessSettingsAtom,
  collabSessionSnapshotRequestsAtom,
  collabWorkItemsAtom,
  remoteTeammateSessionsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import { createCollabAvatarIdentity } from "@src/store/collaboration/protocol";
import {
  COLLAB_CONNECTION_STATUS,
  COLLAB_ROLE,
} from "@src/store/collaboration/types";
import type {
  CollabChatMessageRecord,
  CollabMemberRecord,
  CollabOrgConnectionState,
  CollabOrgRecord,
  CollabProjectMetadataRecord,
  CollabRepoJoinRequestRecord,
  CollabSessionAccessSettings,
  CollabSessionSnapshotRequestRecord,
  CollabWorkItemMetadataRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import { sessionsAtom, upsertSession } from "@src/store/session";
import { persistSessions } from "@src/store/session/sessionAtom/persistence";
import type { Session } from "@src/store/session/sessionAtom/types";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import {
  createDefaultAccessSettings,
  getSyncProfile,
  isRemoteSessionEventsPublishAllowed,
  isRemoteSessionInOrgScope,
  isSessionPushAllowed,
  toRemoteMetadata,
} from "./collabSyncUtils";
import { supabaseSyncClient } from "./sync/supabaseSyncClient";

const SYNC_INTERVAL_MS = 5_000;

interface ActiveCollabConnection {
  org: CollabOrgRecord;
  member: CollabMemberRecord;
  settings: CollabSessionAccessSettings;
}

function createImportedSnapshotSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `imported-session-${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

function rewriteEventsForImportedSnapshot(
  events: SessionEvent[],
  localSessionId: string
): SessionEvent[] {
  return events.map((event) => ({ ...event, sessionId: localSessionId }));
}

function upsertConnectionState(
  current: CollabOrgConnectionState[],
  nextState: CollabOrgConnectionState
): CollabOrgConnectionState[] {
  const existingIndex = current.findIndex(
    (item) => item.orgId === nextState.orgId
  );
  if (existingIndex < 0) return [nextState, ...current];
  const next = [...current];
  next[existingIndex] = nextState;
  return next;
}

function upsertCollabMember(
  current: CollabMemberRecord[],
  incoming: CollabMemberRecord
): CollabMemberRecord[] {
  const existingIndex = current.findIndex(
    (member) => member.orgId === incoming.orgId && member.id === incoming.id
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...incoming };
  return next;
}

function upsertRemoteSession(
  current: RemoteTeammateSessionMetadata[],
  incoming: RemoteTeammateSessionMetadata
): RemoteTeammateSessionMetadata[] {
  const existingIndex = current.findIndex(
    (session) => session.id === incoming.id
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = incoming;
  return next;
}

function upsertChatMessage(
  current: CollabChatMessageRecord[],
  incoming: CollabChatMessageRecord
): CollabChatMessageRecord[] {
  const existingIndex = current.findIndex(
    (message) => message.id === incoming.id
  );
  if (existingIndex < 0) return [...current, incoming];
  const next = [...current];
  next[existingIndex] = incoming;
  return next;
}

function getMetadataId(record: Record<string, unknown>): string | null {
  const id = record.id;
  return typeof id === "string" && id.trim() ? id : null;
}

function upsertCollabMetadataRecord<TRecord extends Record<string, unknown>>(
  current: TRecord[],
  incoming: TRecord
): TRecord[] {
  const incomingId = getMetadataId(incoming);
  if (!incomingId) return [incoming, ...current];
  const existingIndex = current.findIndex(
    (record) => getMetadataId(record) === incomingId
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...incoming };
  return next;
}

function withOrgId<TRecord extends Record<string, unknown>>(
  orgId: string,
  record: TRecord
): TRecord {
  return { ...record, orgId };
}

function upsertSnapshotRequest(
  current: CollabSessionSnapshotRequestRecord[],
  incoming: CollabSessionSnapshotRequestRecord
): CollabSessionSnapshotRequestRecord[] {
  const existingIndex = current.findIndex(
    (request) => request.requestId === incoming.requestId
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...incoming };
  return next;
}

function upsertRepoJoinRequest(
  current: CollabRepoJoinRequestRecord[],
  incoming: CollabRepoJoinRequestRecord
): CollabRepoJoinRequestRecord[] {
  const existingIndex = current.findIndex(
    (request) => request.requestId === incoming.requestId
  );
  if (existingIndex < 0) return [incoming, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...incoming };
  return next;
}

interface ImportedSessionMetadata {
  originalSessionId?: string;
  orgId?: string;
  ownerMemberId?: string;
  contentHash?: string;
}

function parseImportedSessionMetadata(
  session: Session
): ImportedSessionMetadata | null {
  if (session.category !== "external_history") return null;
  if (!session.error_message) return null;
  try {
    const parsed = JSON.parse(session.error_message) as ImportedSessionMetadata;
    return parsed;
  } catch {
    return null;
  }
}

function findImportedSession(
  sessions: Session[],
  orgId: string,
  sourceSessionId: string
): Session | undefined {
  return sessions.find((session) => {
    const meta = parseImportedSessionMetadata(session);
    return meta?.orgId === orgId && meta?.originalSessionId === sourceSessionId;
  });
}

function memberFromRemoteSession(
  session: RemoteTeammateSessionMetadata
): CollabMemberRecord {
  const joinedAt = session.lastActivityAt ?? new Date().toISOString();
  return {
    id: session.ownerMemberId,
    orgId: session.orgId,
    displayName: session.ownerDisplayName,
    avatar: createCollabAvatarIdentity(session.ownerDisplayName),
    role: COLLAB_ROLE.MEMBER,
    identityKind: session.ownerIdentityKind,
    joinedAt,
  };
}

function memberFromChatMessage(
  message: CollabChatMessageRecord
): CollabMemberRecord {
  return {
    id: message.authorMemberId,
    orgId: message.orgId,
    displayName: message.authorDisplayName,
    avatar: createCollabAvatarIdentity(message.authorDisplayName),
    role: COLLAB_ROLE.MEMBER,
    identityKind: message.authorIdentityKind,
    joinedAt: message.createdAt,
  };
}

export function useCollaborationMetadataSync(): void {
  const orgs = useAtomValue(collabOrgsAtom);
  const members = useAtomValue(collabMembersAtom);
  const remoteSessions = useAtomValue(remoteTeammateSessionsAtom);
  const chatMessages = useAtomValue(collabChatMessagesAtom);
  const sessions = useAtomValue(sessionsAtom);
  const accessSettingsList = useAtomValue(collabSessionAccessSettingsAtom);
  const snapshotRequests = useAtomValue(collabSessionSnapshotRequestsAtom);
  const lastSyncTimestamps = useAtomValue(collabLastSyncTimestampsAtom);
  const lastSyncTimestampsRef = useRef(lastSyncTimestamps);
  useEffect(() => {
    lastSyncTimestampsRef.current = lastSyncTimestamps;
  }, [lastSyncTimestamps]);
  const { openSession } = useSessionView();
  const setRemoteSessions = useSetAtom(remoteTeammateSessionsAtom);
  const setConnectionStates = useSetAtom(collabConnectionStatesAtom);
  const setChatMessages = useSetAtom(collabChatMessagesAtom);
  const setMembers = useSetAtom(collabMembersAtom);
  const setInvites = useSetAtom(collabInvitesAtom);
  const setProjects = useSetAtom(collabProjectsAtom);
  const setWorkItems = useSetAtom(collabWorkItemsAtom);
  const setSnapshotRequests = useSetAtom(collabSessionSnapshotRequestsAtom);
  const setRepoJoinRequests = useSetAtom(collabRepoJoinRequestsAtom);
  const setLastSyncTimestamps = useSetAtom(collabLastSyncTimestampsAtom);

  const activeConnections = useMemo<ActiveCollabConnection[]>(
    () =>
      orgs.flatMap((org) => {
        const profile = getSyncProfile(org);
        if (!profile) return [];
        const member = members.find(
          (candidate) =>
            candidate.orgId === org.id &&
            candidate.id === org.localMemberId &&
            !candidate.removedAt
        );
        if (!member) return [];
        const settings =
          accessSettingsList.find(
            (candidate) =>
              candidate.orgId === org.id && candidate.memberId === member.id
          ) ?? createDefaultAccessSettings(org.id, member.id);
        return [{ org, member, settings }];
      }),
    [accessSettingsList, members, orgs]
  );

  useEffect(() => {
    const inferredMembers = [
      ...remoteSessions.map(memberFromRemoteSession),
      ...chatMessages.map(memberFromChatMessage),
    ];
    if (inferredMembers.length === 0) return;
    setMembers((current) =>
      inferredMembers.reduce(upsertCollabMember, current)
    );
  }, [chatMessages, remoteSessions, setMembers]);

  useEffect(() => {
    if (activeConnections.length === 0) return;
    let cancelled = false;

    const setStatus = (
      orgId: string,
      status: CollabOrgConnectionState["status"],
      error?: string
    ) => {
      setConnectionStates((current) =>
        upsertConnectionState(current, {
          orgId,
          status,
          error,
          updatedAt: new Date().toISOString(),
        })
      );
    };

    const createProfile = (org: CollabOrgRecord) => {
      const profile = getSyncProfile(org);
      if (!profile) throw new Error("Supabase sync profile is incomplete");
      return profile;
    };

    const syncConnection = async ({
      org,
      member,
      settings,
    }: ActiveCollabConnection) => {
      const profile = createProfile(org);
      setStatus(org.id, COLLAB_CONNECTION_STATUS.CONNECTING);

      await supabaseSyncClient.verifySetup(profile);

      for (const session of sessions) {
        if (!isSessionPushAllowed(session, org, settings)) {
          await supabaseSyncClient.removeSessionMetadata({
            ...profile,
            orgId: org.id,
            ownerMemberId: member.id,
            sourceSessionId: session.session_id,
          });
          continue;
        }
        await supabaseSyncClient.upsertSessionMetadata({
          ...profile,
          session: toRemoteMetadata(session, org, member, settings),
        });
      }

      for (const request of snapshotRequests) {
        if (
          request.orgId === org.id &&
          request.requesterMemberId === member.id &&
          request.status === "pending"
        ) {
          await supabaseSyncClient.requestSessionSnapshot({
            ...profile,
            requestId: request.requestId,
            orgId: request.orgId,
            requesterMemberId: request.requesterMemberId,
            ownerMemberId: request.ownerMemberId,
            sourceSessionId: request.sourceSessionId,
          });
          setSnapshotRequests((current) =>
            current.map((item) =>
              item.requestId === request.requestId
                ? { ...item, status: "sent" }
                : item
            )
          );
        }
      }

      const sinceTimestamp = lastSyncTimestampsRef.current[org.id];
      const state = await supabaseSyncClient.listOrgState({
        ...profile,
        orgId: org.id,
        sinceTimestamp,
      });
      if (cancelled) return;

      setMembers((current) =>
        state.members.reduce(upsertCollabMember, current)
      );
      setInvites((current) =>
        state.invites.reduce((next, invite) => {
          const existingIndex = next.findIndex((item) => item.id === invite.id);
          if (existingIndex < 0) return [invite, ...next];
          const copy = [...next];
          copy[existingIndex] = invite;
          return copy;
        }, current)
      );
      setProjects((current) =>
        state.projects
          .map((project) =>
            withOrgId<CollabProjectMetadataRecord>(org.id, project)
          )
          .reduce(upsertCollabMetadataRecord, current)
      );
      setWorkItems((current) =>
        state.workItems
          .map((workItem) =>
            withOrgId<CollabWorkItemMetadataRecord>(org.id, workItem)
          )
          .reduce(upsertCollabMetadataRecord, current)
      );

      const inScopeSessions = state.sessions.filter((session) =>
        isRemoteSessionInOrgScope(session, org)
      );
      setRemoteSessions((current) =>
        inScopeSessions.reduce(upsertRemoteSession, current)
      );
      setChatMessages((current) =>
        state.chatMessages.reduce(upsertChatMessage, current)
      );
      setSnapshotRequests((current) =>
        state.snapshotRequests.reduce(
          (next, request) =>
            upsertSnapshotRequest(next, {
              requestId: request.requestId,
              orgId: request.orgId,
              requesterMemberId: request.requesterMemberId,
              ownerMemberId: request.ownerMemberId,
              sourceSessionId: request.sourceSessionId,
              createdAt: request.createdAt,
              status: request.status,
              error: request.error,
            }),
          current
        )
      );
      setRepoJoinRequests((current) =>
        state.repoJoinRequests.reduce(upsertRepoJoinRequest, current)
      );

      for (const remoteSession of inScopeSessions) {
        if (remoteSession.ownerMemberId === member.id) continue;
        if (!remoteSession.eventsContentHash || !remoteSession.eventsBlobPath) {
          continue;
        }
        const existingImported = findImportedSession(
          sessions,
          org.id,
          remoteSession.sourceSessionId
        );
        const existingMeta = existingImported
          ? parseImportedSessionMetadata(existingImported)
          : null;
        if (existingMeta?.contentHash === remoteSession.eventsContentHash) {
          continue;
        }
        try {
          const events = await supabaseSyncClient.downloadSessionEventsBlob({
            ...profile,
            blobPath: remoteSession.eventsBlobPath,
          });
          if (cancelled) return;
          const localSessionId =
            existingImported?.session_id ?? createImportedSnapshotSessionId();
          const localEvents = rewriteEventsForImportedSnapshot(
            events,
            localSessionId
          );
          const now = new Date().toISOString();
          upsertSession({
            session_id: localSessionId,
            status: "completed",
            created_at: existingImported?.created_at ?? now,
            updated_at: now,
            completed_at: now,
            name: remoteSession.title,
            repoPath: remoteSession.repoPath,
            category: "external_history",
            model: "Collaboration Snapshot",
            agentIconId: "archive",
            agentDisplayName: "Collaboration Snapshot",
            pinned: existingImported?.pinned ?? false,
            error_message: JSON.stringify({
              originalSessionId: remoteSession.sourceSessionId,
              originalCategory: "rust_agent",
              exportedAt: now,
              eventCount: localEvents.length,
              orgId: org.id,
              ownerMemberId: remoteSession.ownerMemberId,
              contentHash: remoteSession.eventsContentHash,
              ownerDisplayName: remoteSession.ownerDisplayName,
            }),
          });
          persistSessions(getInstrumentedStore().get(sessionsAtom));
          await eventStoreProxy.set(localEvents, localSessionId);
        } catch (error) {
          setStatus(
            org.id,
            COLLAB_CONNECTION_STATUS.ERROR,
            `Failed to import session ${remoteSession.sourceSessionId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      for (const request of state.snapshotRequests) {
        if (
          request.ownerMemberId === member.id &&
          request.status === "pending"
        ) {
          const sourceSession = sessions.find(
            (session) => session.session_id === request.sourceSessionId
          );
          if (!sourceSession) {
            await supabaseSyncClient.denySessionSnapshot({
              ...profile,
              requestId: request.requestId,
              reason: "Session is unavailable on the owner device",
            });
            continue;
          }
          const metadata = toRemoteMetadata(
            sourceSession,
            org,
            member,
            settings
          );
          if (!isRemoteSessionEventsPublishAllowed(metadata, org, settings)) {
            await supabaseSyncClient.denySessionSnapshot({
              ...profile,
              requestId: request.requestId,
              reason: "Session replay is not allowed by owner settings",
            });
            continue;
          }
          const events = await eventStoreProxy.getEvents(
            sourceSession.session_id
          );
          await supabaseSyncClient.publishSessionSnapshot({
            ...profile,
            requestId: request.requestId,
            orgId: org.id,
            sourceSessionId: sourceSession.session_id,
            session: metadata,
            events,
          });
        }

        if (
          request.requesterMemberId === member.id &&
          request.status === "completed" &&
          request.session &&
          request.events &&
          snapshotRequests.find((item) => item.requestId === request.requestId)
            ?.status !== "completed"
        ) {
          const localSessionId = createImportedSnapshotSessionId();
          const localEvents = rewriteEventsForImportedSnapshot(
            request.events,
            localSessionId
          );
          const now = new Date().toISOString();
          upsertSession({
            session_id: localSessionId,
            status: "completed",
            created_at: now,
            updated_at: now,
            completed_at: now,
            name: request.session.title,
            repoPath: request.session.repoPath,
            category: "external_history",
            model: "Collaboration Snapshot",
            agentIconId: "archive",
            agentDisplayName: "Collaboration Snapshot",
            pinned: false,
            error_message: JSON.stringify({
              originalSessionId: request.sourceSessionId,
              originalCategory: "rust_agent",
              exportedAt: now,
              eventCount: localEvents.length,
              orgId: request.orgId,
              ownerMemberId: request.session.ownerMemberId,
              snapshotRequestId: request.requestId,
              ownerDisplayName: request.session.ownerDisplayName,
            }),
          });
          persistSessions(getInstrumentedStore().get(sessionsAtom));
          await eventStoreProxy.set(localEvents, localSessionId);
          setSnapshotRequests((current) =>
            current.map((item) =>
              item.requestId === request.requestId
                ? { ...item, status: "completed", error: undefined }
                : item
            )
          );
          openSession(
            localSessionId,
            request.session.title,
            request.session.repoPath
          );
        }
      }

      setStatus(org.id, COLLAB_CONNECTION_STATUS.CONNECTED);
      const syncCompletedAt = new Date().toISOString();
      setLastSyncTimestamps((current) => ({
        ...current,
        [org.id]: syncCompletedAt,
      }));
    };

    const runSync = () => {
      for (const connection of activeConnections) {
        void syncConnection(connection).catch((error: unknown) => {
          setStatus(
            connection.org.id,
            COLLAB_CONNECTION_STATUS.ERROR,
            error instanceof Error ? error.message : String(error)
          );
        });
      }
    };

    runSync();
    const interval = window.setInterval(runSync, SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    activeConnections,
    openSession,
    sessions,
    setChatMessages,
    setConnectionStates,
    setInvites,
    setLastSyncTimestamps,
    setMembers,
    setProjects,
    setRemoteSessions,
    setRepoJoinRequests,
    setSnapshotRequests,
    setWorkItems,
    snapshotRequests,
  ]);
}
