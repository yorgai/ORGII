/**
 * Work-item + linked-session actions for the collab panel (design §16.7 / §16.9).
 *
 * - `handleOpenWorkItem`: opens a shared work item in the main ProjectManager
 *   detail surface. Shared work items are NATIVE local rows (design §16.2), so
 *   this is the SAME navigation the ProjectManager uses — the work item is a
 *   real entity, keyed by the aliased project org (`projectOrgId ?? id`).
 * - `handleReplayLinkedSession`: replays a teammate's agent session linked to a
 *   work item through the SAME `importRemoteSession` path SessionsSection /
 *   the engine use (design §16.7 — the payoff: work item → "what happened").
 * - `handleForkLinkedSession`: "fork & continue" (design §16.11) for the same
 *   linked session — lands the full history as MY writable session via
 *   `forkTeammateSession` so an agent can pick the work item up from that
 *   context.
 */
import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { useCallback, useState } from "react";

import type { EnrichedWorkItem, ProjectData } from "@src/api/http/project";
import { enrichedWorkItemToUI, projectDataToUI } from "@src/api/http/project";
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
import type { CollabOrgRecord } from "@src/store/collaboration/types";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import {
  CHAT_PANEL_SURFACE_KIND,
  chatPanelNavigateAtom,
} from "@src/store/ui/chatPanelAtom";

const logger = createLogger("collabWorkItemActions");

interface UseWorkItemActionsParams {
  org: CollabOrgRecord | undefined;
  orgProjects: ProjectData[];
  t: TFunction<"navigation">;
}

export function useWorkItemActions({
  org,
  orgProjects,
  t,
}: UseWorkItemActionsParams) {
  const navigateChatPanel = useSetAtom(chatPanelNavigateAtom);
  const { openSession } = useSessionView();
  const [replayingSessionId, setReplayingSessionId] = useState<string | null>(
    null
  );
  const [forkingLinkedSessionId, setForkingLinkedSessionId] = useState<
    string | null
  >(null);

  // Open a shared work item in the main ProjectManager detail surface. The
  // orgId is the aliased project org (§16.2) so ProjectManager scopes reads
  // to the collab org's local rows.
  const handleOpenWorkItem = useCallback(
    (workItem: EnrichedWorkItem) => {
      if (!org) return;
      const projectOrgId = org.projectOrgId ?? org.id;
      const project = workItem.project
        ? orgProjects.find(
            (candidate) => candidate.meta.id === workItem.project?.id
          )
        : undefined;
      const sourceProject = project
        ? {
            project: projectDataToUI(project, {
              labelMap: new Map(),
              memberMap: new Map(),
            }),
            projectSlug: project.slug,
            orgId: projectOrgId,
            orgName: org.name,
          }
        : undefined;

      navigateChatPanel({
        kind: CHAT_PANEL_SURFACE_KIND.WORK_ITEM,
        workItem: {
          workItem: enrichedWorkItemToUI(workItem),
          projectId: project?.meta.id ?? workItem.project?.id ?? "",
          projectName: project?.meta.name ?? workItem.project?.name ?? "",
          projectSlug: project?.slug ?? "",
          shortId: workItem.shortId,
          orgId: projectOrgId,
          orgName: org.name,
          sourceProject,
        },
      });
    },
    [navigateChatPanel, org, orgProjects]
  );

  // Replay a teammate's linked session through the shared importer, then open
  // it. Reuses the exact path SessionsSection uses (cursor diff + incremental
  // fetch + persistence). `remoteSession` is the resolved shared record.
  const handleReplayLinkedSession = useCallback(
    async (remoteSession: RemoteTeammateSessionMetadata) => {
      if (!org || remoteSession.eventsEpoch === undefined) return;
      const profile = getSyncProfile(org) as SupabaseSyncProfile | null;
      if (!profile) return;
      setReplayingSessionId(remoteSession.sourceSessionId);
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
        }
      } catch (error) {
        // A persisted linked-session record can outlive the share (owner
        // revoked it / dialed accessMode down): the Replay button still
        // renders, so the failure must be user-visible, not logger-only.
        logger.error("failed to replay linked session", error);
        Message.error(t("collaboration.workitem.replayUnavailable"));
      } finally {
        setReplayingSessionId(null);
      }
    },
    [openSession, org, t]
  );

  // "Fork & continue" for a work item's linked teammate session (design
  // §16.11): same resolution + gating as replay (a shared record with
  // published segments), but the history lands as MY writable session via
  // forkTeammateSession (engine fork + backend row + first-send context
  // handoff) so the work item can be picked up from that exact context.
  const handleForkLinkedSession = useCallback(
    async (remoteSession: RemoteTeammateSessionMetadata) => {
      if (!org || remoteSession.eventsEpoch === undefined) return;
      const profile = getSyncProfile(org) as SupabaseSyncProfile | null;
      if (!profile) return;
      setForkingLinkedSessionId(remoteSession.sourceSessionId);
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
        // Same failure surface as replay: the record can outlive the share,
        // and the durable event-cache write can fail — toast, don't swallow.
        logger.error("failed to fork linked session", error);
        Message.error(t("collaboration.session.forkFailed"));
      } finally {
        setForkingLinkedSessionId(null);
      }
    },
    [openSession, org, t]
  );

  return {
    handleOpenWorkItem,
    handleReplayLinkedSession,
    handleForkLinkedSession,
    replayingSessionId,
    forkingLinkedSessionId,
    replayUnavailableLabel: t("collaboration.workitem.linkedSessionUnshared"),
  };
}
