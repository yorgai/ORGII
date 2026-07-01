import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { useCallback, useState } from "react";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  type SupabaseSyncProfile,
  getSyncProfile,
} from "@src/features/TeamCollaboration/collabSyncUtils";
import { supabaseSyncClient } from "@src/features/TeamCollaboration/sync/supabaseSyncClient";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import type { SessionTableItem } from "@src/modules/shared/layouts/blocks";
import { collabSessionSnapshotRequestsAtom } from "@src/store/collaboration/collabOrgsAtom";
import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import { upsertSession } from "@src/store/session";
import { sessionsAtom } from "@src/store/session";
import { persistSessions } from "@src/store/session/sessionAtom/persistence";
import type { Session } from "@src/store/session/sessionAtom/types";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { COLLAB_SNAPSHOT_REQUEST_STATUS } from "./constants";

interface UseSessionActionsParams {
  org: CollabOrgRecord | undefined;
  orgSessions: RemoteTeammateSessionMetadata[];
  sessions: Session[];
  currentMember: CollabMemberRecord | undefined;
  t: TFunction<"navigation">;
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

function findImportedSession(
  sessions: Session[],
  orgId: string,
  sourceSessionId: string
): Session | undefined {
  return sessions.find((session) => {
    if (session.category !== "external_history") return false;
    if (!session.error_message) return false;
    try {
      const meta = JSON.parse(session.error_message) as {
        orgId?: string;
        originalSessionId?: string;
      };
      return meta.orgId === orgId && meta.originalSessionId === sourceSessionId;
    } catch {
      return false;
    }
  });
}

export function useSessionActions({
  org,
  orgSessions,
  sessions,
  currentMember,
  t,
}: UseSessionActionsParams) {
  const { openSession } = useSessionView();
  const setSnapshotRequests = useSetAtom(collabSessionSnapshotRequestsAtom);
  const [importingSessionId, setImportingSessionId] = useState<string | null>(
    null
  );

  const handleSelectSession = useCallback(
    async (item: SessionTableItem) => {
      const remoteSession = orgSessions.find(
        (session) => session.id === item.id
      );
      if (!remoteSession) return;

      const localSession = sessions.find(
        (session) =>
          session.session_id === remoteSession.sourceSessionId ||
          session.session_id === remoteSession.id
      );

      if (localSession) {
        openSession(
          localSession.session_id,
          localSession.name || localSession.user_input || remoteSession.title,
          localSession.repoPath ?? remoteSession.repoPath
        );
        return;
      }

      if (
        remoteSession.eventsBlobPath &&
        remoteSession.eventsContentHash &&
        org
      ) {
        const profile = getSyncProfile(org) as SupabaseSyncProfile | null;
        if (profile) {
          setImportingSessionId(remoteSession.id);
          try {
            const events = await supabaseSyncClient.downloadSessionEventsBlob({
              ...profile,
              blobPath: remoteSession.eventsBlobPath,
            });
            const localSessionId =
              findImportedSession(
                sessions,
                org.id,
                remoteSession.sourceSessionId
              )?.session_id ?? createImportedSnapshotSessionId();
            const localEvents = rewriteEventsForImportedSnapshot(
              events,
              localSessionId
            );
            const now = new Date().toISOString();
            upsertSession({
              session_id: localSessionId,
              status: "completed",
              created_at: now,
              updated_at: now,
              completed_at: now,
              name: remoteSession.title,
              repoPath: remoteSession.repoPath,
              category: "external_history",
              model: "Collaboration Snapshot",
              agentIconId: "archive",
              agentDisplayName: "Collaboration Snapshot",
              pinned: false,
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
            persistSessions(
              getInstrumentedStore().get(sessionsAtom) as Session[]
            );
            await eventStoreProxy.set(localEvents, localSessionId);
            openSession(
              localSessionId,
              remoteSession.title,
              remoteSession.repoPath
            );
          } finally {
            setImportingSessionId(null);
          }
          return;
        }
      }

      if (remoteSession.accessMode !== COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY) {
        setSnapshotRequests((current) => [
          {
            requestId: crypto.randomUUID(),
            orgId: remoteSession.orgId,
            requesterMemberId: currentMember?.id ?? "local-member",
            ownerMemberId: remoteSession.ownerMemberId,
            sourceSessionId: remoteSession.sourceSessionId,
            createdAt: new Date().toISOString(),
            status: COLLAB_SNAPSHOT_REQUEST_STATUS.DENIED,
            error: t("collaboration.access.metadataOnlyDenied"),
          },
          ...current,
        ]);
        return;
      }

      setSnapshotRequests((current) => [
        {
          requestId: crypto.randomUUID(),
          orgId: remoteSession.orgId,
          requesterMemberId: currentMember?.id ?? "local-member",
          ownerMemberId: remoteSession.ownerMemberId,
          sourceSessionId: remoteSession.sourceSessionId,
          createdAt: new Date().toISOString(),
          status: COLLAB_SNAPSHOT_REQUEST_STATUS.PENDING,
        },
        ...current,
      ]);
    },
    [
      currentMember?.id,
      openSession,
      org,
      orgSessions,
      sessions,
      setSnapshotRequests,
      t,
    ]
  );

  return { handleSelectSession, importingSessionId };
}
