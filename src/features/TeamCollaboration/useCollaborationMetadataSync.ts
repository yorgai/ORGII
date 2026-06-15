import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";

import {
  collabConnectionStatesAtom,
  collabMembersAtom,
  collabOrgsAtom,
  remoteTeammateSessionsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
} from "@src/store/collaboration/protocol";
import { COLLAB_CONNECTION_STATUS } from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgConnectionState,
  CollabOrgRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session";
import type { Session } from "@src/store/session/sessionAtom/types";

import { connectCollabOrgRoom } from "./collabHubClient";

function toRemoteMetadata(
  session: Session,
  org: CollabOrgRecord,
  member: CollabMemberRecord
): RemoteTeammateSessionMetadata {
  return {
    id: `${org.id}:${member.id}:${session.session_id}`,
    orgId: org.id,
    ownerMemberId: member.id,
    ownerUserId: member.id,
    ownerDisplayName: member.displayName,
    ownerIdentityKind: member.identityKind,
    sourceSessionId: session.session_id,
    title: session.name || session.user_input || session.session_id,
    status: String(session.status),
    repoPath: session.repoPath,
    branch: session.branch || session.worktreeBranch,
    lastActivityAt: session.updated_at || session.updated_time,
  };
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

export function useCollaborationMetadataSync(): void {
  const orgs = useAtomValue(collabOrgsAtom);
  const members = useAtomValue(collabMembersAtom);
  const sessions = useAtomValue(sessionsAtom);
  const setRemoteSessions = useSetAtom(remoteTeammateSessionsAtom);
  const setConnectionStates = useSetAtom(collabConnectionStatesAtom);

  const activeConnections = useMemo(
    () =>
      orgs.flatMap((org) => {
        const member = members.find(
          (candidate) =>
            candidate.orgId === org.id &&
            candidate.accessToken &&
            !candidate.removedAt
        );
        return org.hubUrl && member?.accessToken ? [{ org, member }] : [];
      }),
    [members, orgs]
  );

  useEffect(() => {
    if (activeConnections.length === 0) return;
    const sockets = activeConnections.map(({ org, member }) => {
      const setStatus = (
        status: CollabOrgConnectionState["status"],
        error?: string
      ) => {
        setConnectionStates((current) =>
          upsertConnectionState(current, {
            orgId: org.id,
            status,
            error,
            updatedAt: new Date().toISOString(),
          })
        );
      };

      setStatus(COLLAB_CONNECTION_STATUS.CONNECTING);
      const socket = connectCollabOrgRoom({
        hubUrl: org.hubUrl ?? "",
        orgId: org.id,
        accessToken: member.accessToken ?? "",
        onOpen: () => {
          setStatus(COLLAB_CONNECTION_STATUS.CONNECTED);
          for (const session of sessions) {
            socket.send({
              protocolVersion: COLLAB_PROTOCOL_VERSION,
              id: crypto.randomUUID(),
              type: COLLAB_MESSAGE_TYPE.SESSION_METADATA_UPSERT,
              orgId: org.id,
              senderMemberId: member.id,
              sentAt: new Date().toISOString(),
              payload: {
                session: toRemoteMetadata(session, org, member),
              },
            });
          }
        },
        onClose: () => setStatus(COLLAB_CONNECTION_STATUS.DISCONNECTED),
        onError: () =>
          setStatus(COLLAB_CONNECTION_STATUS.ERROR, "Connection failed"),
        onMessage: (message) => {
          if (message.senderMemberId === member.id) return;
          if (message.type === COLLAB_MESSAGE_TYPE.SESSION_METADATA_UPSERT) {
            setRemoteSessions((current) => {
              const incoming = message.payload.session;
              const existingIndex = current.findIndex(
                (session) => session.id === incoming.id
              );
              if (existingIndex < 0) return [incoming, ...current];
              const next = [...current];
              next[existingIndex] = incoming;
              return next;
            });
          }
          if (message.type === COLLAB_MESSAGE_TYPE.SESSION_METADATA_REMOVE) {
            setRemoteSessions((current) =>
              current.filter(
                (session) =>
                  session.sourceSessionId !== message.payload.sessionId
              )
            );
          }
        },
      });
      return socket;
    });

    return () => {
      for (const socket of sockets) socket.close();
    };
  }, [activeConnections, sessions, setConnectionStates, setRemoteSessions]);
}
