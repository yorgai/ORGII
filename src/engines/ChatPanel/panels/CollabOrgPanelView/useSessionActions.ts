import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { useCallback, useState } from "react";

import Message from "@src/components/Message";
import {
  type SupabaseSyncProfile,
  getSyncProfile,
} from "@src/features/TeamCollaboration/collabSyncUtils";
import { importRemoteSession } from "@src/features/TeamCollaboration/engine/collabSyncEngineHelpers";
import { forkTeammateSession } from "@src/features/TeamCollaboration/forkSession";
import { supabaseSyncClient } from "@src/features/TeamCollaboration/sync/supabaseSyncClient";
import { createLogger } from "@src/hooks/logger";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import type { SessionTableItem } from "@src/modules/shared/layouts/blocks";
import { collabSessionSnapshotRequestsAtom } from "@src/store/collaboration/collabOrgsAtom";
import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import { COLLAB_SNAPSHOT_REQUEST_STATUS } from "./constants";

const logger = createLogger("collabSessionActions");

interface UseSessionActionsParams {
  org: CollabOrgRecord | undefined;
  orgSessions: RemoteTeammateSessionMetadata[];
  sessions: Session[];
  currentMember: CollabMemberRecord | undefined;
  t: TFunction<"navigation">;
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
  const [forkingSessionId, setForkingSessionId] = useState<string | null>(null);

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

      // Direct replay through the shared segments importer (design §7.4 /
      // M5 dedup): the same function the engine's PullLoop uses, so this
      // path gets cursor diffing + incremental fetch + persistence for free.
      if (org && remoteSession.eventsEpoch !== undefined) {
        const profile = getSyncProfile(org) as SupabaseSyncProfile | null;
        if (profile) {
          setImportingSessionId(remoteSession.id);
          try {
            const result = await importRemoteSession({
              client: supabaseSyncClient,
              profile,
              orgId: org.id,
              remoteSession,
            });
            if (result) {
              openSession(
                result.localSessionId,
                remoteSession.title,
                remoteSession.repoPath
              );
              return;
            }
          } finally {
            setImportingSessionId(null);
          }
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

  // "Fork & continue" (design §16.11): unlike the read-only replay above,
  // this lands the teammate's full history as MY OWN writable session and
  // opens it. `forkTeammateSession` is the full relay — engine fork +
  // backend row registration (dispatchability, list durability) + first-send
  // context handoff arming. Gated on the session being replay-capable —
  // published segments must exist (metadata-only cards have nothing to
  // inherit), which is the same signal the ⑂ row action renders on.
  const handleForkSession = useCallback(
    async (item: SessionTableItem) => {
      if (!org) return;
      const remoteSession = orgSessions.find(
        (session) => session.id === item.id
      );
      if (!remoteSession || remoteSession.eventsEpoch === undefined) return;
      const profile = getSyncProfile(org) as SupabaseSyncProfile | null;
      if (!profile) return;

      setForkingSessionId(remoteSession.id);
      try {
        const result = await forkTeammateSession({
          client: supabaseSyncClient,
          profile,
          orgId: org.id,
          remoteSession,
        });
        if (!result) {
          Message.error(t("collaboration.session.forkFailed"));
          return;
        }
        Message.success(
          t("collaboration.session.forkedFromLabel", {
            name: remoteSession.ownerDisplayName,
          })
        );
        openSession(result.localSessionId, result.name, remoteSession.repoPath);
      } catch (error) {
        // The share can be revoked / dialed down between render and click,
        // and the durable cache write can fail — both must be user-visible.
        logger.error("failed to fork session", error);
        Message.error(t("collaboration.session.forkFailed"));
      } finally {
        setForkingSessionId(null);
      }
    },
    [openSession, org, orgSessions, t]
  );

  return {
    handleSelectSession,
    handleForkSession,
    importingSessionId,
    forkingSessionId,
  };
}
