import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef } from "react";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store";
import {
  collabConnectionStatesAtom,
  collabMembersAtom,
  collabOrgsAtom,
  collabSessionAccessSettingsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import {
  COLLAB_CONNECTION_STATUS,
  COLLAB_SESSION_ACCESS_MODE,
} from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgConnectionState,
  CollabOrgRecord,
  CollabSessionAccessSettings,
} from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session";

import {
  type SupabaseSyncProfile,
  createDefaultAccessSettings,
  getSyncProfile,
  isSessionPushAllowed,
  sha256Hex,
  toRemoteMetadata,
} from "./collabSyncUtils";
import { supabaseSyncClient } from "./sync/supabaseSyncClient";

const PUSH_DEBOUNCE_MS = 3_000;

interface ActiveCollabConnection {
  org: CollabOrgRecord;
  member: CollabMemberRecord;
  settings: CollabSessionAccessSettings;
  profile: SupabaseSyncProfile;
}

export function useCollaborationSessionPush(): void {
  const orgs = useAtomValue(collabOrgsAtom);
  const members = useAtomValue(collabMembersAtom);
  const sessions = useAtomValue(sessionsAtom);
  const accessSettingsList = useAtomValue(collabSessionAccessSettingsAtom);
  const setConnectionStates = useSetAtom(collabConnectionStatesAtom);

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
        return [{ org, member, settings, profile }];
      }),
    [accessSettingsList, members, orgs]
  );

  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const connectionsRef = useRef(activeConnections);
  useEffect(() => {
    connectionsRef.current = activeConnections;
  }, [activeConnections]);

  const debounceTimersRef = useRef<Map<string, number>>(new Map());
  const lastPushedHashRef = useRef<Map<string, string>>(new Map());
  const inFlightPushRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const setStatus = (
      orgId: string,
      status: CollabOrgConnectionState["status"],
      error?: string
    ) => {
      setConnectionStates((current) => {
        const existing = current.find((item) => item.orgId === orgId);
        if (
          existing?.status === status &&
          existing.error === error &&
          existing.status === COLLAB_CONNECTION_STATUS.CONNECTED
        ) {
          return current;
        }
        return [
          {
            orgId,
            status,
            error,
            updatedAt: new Date().toISOString(),
          },
          ...current.filter((item) => item.orgId !== orgId),
        ];
      });
    };

    const pushSession = async (sessionId: string): Promise<void> => {
      if (inFlightPushRef.current.has(sessionId)) return;
      inFlightPushRef.current.add(sessionId);
      try {
        const sessionList = sessionsRef.current;
        const connections = connectionsRef.current;
        const session = sessionList.find(
          (candidate) => candidate.session_id === sessionId
        );
        if (!session) return;

        for (const { org, member, settings, profile } of connections) {
          if (!isSessionPushAllowed(session, org, settings)) continue;

          if (settings.accessMode !== COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY) {
            continue;
          }

          const cacheKey = `${org.id}:${sessionId}`;
          try {
            const events = await eventStoreProxy.getEvents(sessionId);
            const serialized = JSON.stringify({ events });
            const hash = await sha256Hex(serialized);
            if (lastPushedHashRef.current.get(cacheKey) === hash) continue;

            await supabaseSyncClient.upsertSessionMetadata({
              ...profile,
              session: toRemoteMetadata(session, org, member, settings),
            });
            await supabaseSyncClient.upsertSessionEvents({
              ...profile,
              orgId: org.id,
              sourceSessionId: sessionId,
              events,
            });
            lastPushedHashRef.current.set(cacheKey, hash);
          } catch (error) {
            setStatus(
              org.id,
              COLLAB_CONNECTION_STATUS.ERROR,
              `Failed to push session ${sessionId}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
      } finally {
        inFlightPushRef.current.delete(sessionId);
      }
    };

    const schedulePush = (sessionId: string): void => {
      const existing = debounceTimersRef.current.get(sessionId);
      if (existing !== undefined) {
        window.clearTimeout(existing);
      }
      const timer = window.setTimeout(() => {
        debounceTimersRef.current.delete(sessionId);
        void pushSession(sessionId);
      }, PUSH_DEBOUNCE_MS);
      debounceTimersRef.current.set(sessionId, timer);
    };

    const unsubscribe = eventStoreProxy.subscribe((_snapshot, sessionId) => {
      schedulePush(sessionId);
    });

    return () => {
      unsubscribe();
      debounceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      debounceTimersRef.current.clear();
    };
  }, [setConnectionStates]);
}
